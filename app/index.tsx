import { useState, useEffect, useRef } from "react"
import { Text,View,StyleSheet,Button,FlatList,TouchableOpacity,ActivityIndicator,Alert,SafeAreaView,StatusBar,Platform} from "react-native"
import { Ionicons } from "@expo/vector-icons"
import * as Location from "expo-location"
import * as Clipboard from "expo-clipboard"
import { CameraView, type CameraType, useCameraPermissions, type BarcodeScanningResult } from "expo-camera"
import * as Notifications from "expo-notifications"

// Importamos nuestras clases de base de datos local
import { connectDb, type Database } from "../src/database"
import type { ScannedCode } from "../src/models"

// === CONFIGURACIÓN DE MODO LOCAL ===
const isLocalMode = true // Cambiar: a true para activar el modo local, false para modo servidor
// Si es modo local, no se sincronizará con el servidor, de todos modos ahí dice en el header de la app 
const API_URL = "http://192.168.1.76:3000" //CAMBIAR ESTO POR LA IP DE LA RED  PARA QUE JALE EN IOS/ANDROID

// Configuración del manejador de notificaciones
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

export default function QRScannerScreen() {
  // === ESTADOS ===
  const [location, setLocation] = useState<Location.LocationObject | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [facing, setFacing] = useState<CameraType>("back")
  const [permission, requestPermission] = useCameraPermissions()
  const [scannedCodes, setScannedCodes] = useState<ScannedCode[]>([])
  const [db, setDB] = useState<Database>()
  const [isScanning, setIsScanning] = useState(true) // Estado para controlar el escaneo
  const [isSyncing, setIsSyncing] = useState(false)
  const [stats, setStats] = useState<{ total: number; porTipo: any[]; ultimoEscaneo: string | null }>({
    total: 0,
    porTipo: [],
    ultimoEscaneo: null,
  })

  // === REFS PARA CONTROL DE ESCANEO ===
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isProcessingRef = useRef<boolean>(false)

  // === CONSTANTES DE CONFIGURACIÓN ===
  const SCAN_COOLDOWN = 3000 // 3 segundos entre escaneos del mismo código
  const PROCESSING_TIMEOUT = 1000 // 1 segundo para procesar un escaneo

  useEffect(() => {
    async function getCurrentLocation() {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== "granted") {
        setErrorMsg("Permission to access location was denied")
        return
      }

      const location = await Location.getCurrentPositionAsync({})
      setLocation(location)
    }

    async function retrieveLocalDbData() {
      try {
        const database = await connectDb()
        setDB(database)
        await updateData(database)
      } catch (error) {
        console.error("Error conectando a la base de datos:", error)
        Alert.alert("Error", "No se pudo conectar a la base de datos")
      }
    }

    getCurrentLocation()
    retrieveLocalDbData()

    // Cleanup al desmontar
    return () => {
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current)
      }
    }
  }, [])

  // Función para actualizar datos y estadísticas
  const updateData = async (database: Database) => {
    try {
      const codes = await database.consultarCodigos()
      const statistics = await database.obtenerEstadisticas()
      setScannedCodes(codes)
      setStats(statistics)
    } catch (error) {
      console.error("Error actualizando datos:", error)
    }
  }


  // === FUNCIÓN DE ESCANEO ===
  const onBarcodeScanned = async function (result: BarcodeScanningResult) {
    //Tratar de evitar escaneos del mismo código
    if (!isScanning) return;

    //Desactivar el escaneo 
    setIsScanning(false)

    //Reactivar el escaneo después de un timeout
    setTimeout(() => {
      setIsScanning(true)
    }, 1000)  

    //Notificación con el código escaneado
    await showNotification(`Código escaneado: ${result.data}`)

    //Guardamos en la base de datos LOCAL
    if (db) {
      await db.insertarCodigo(result.data, result.type)
      setScannedCodes(await db.consultarCodigos())
      await updateData(db)
    }

  }
    
  // === FUNCIÓN DE SINCRONIZACIÓN ===
  const syncWithServer = async () => {
    if (!scannedCodes.length) {
      Alert.alert("Sincronización", "No hay códigos para sincronizar")
      return
    }

    setIsSyncing(true)

    try {
      if (isLocalMode) {
        setTimeout(() => {
          Alert.alert(
            "Modo Local",
            `Estás trabajando en modo local. Tienes ${scannedCodes.length} códigos almacenados localmente.`,
          )
          setIsSyncing(false)
        }, 500)
        return
      }

      for (const code of scannedCodes) {
        await fetch(`${API_URL}/codigos`, {
          method: "POST",
          headers: {
            Accept: "application/json;encoding=utf-8",
            "Content-Type": "application/json;encoding=utf-8",
          },
          body: JSON.stringify({
            data: code.data,
            type: code.type,
            timestamp: code.timestamp,
          }),
        })
      }

      Alert.alert("Sincronización Exitosa", `Se han sincronizado ${scannedCodes.length} códigos con el servidor`)
    } catch (error) {
      console.error("Error al sincronizar:", error)
      Alert.alert("Error de Sincronización", "No se pudieron sincronizar los códigos. Verifica tu conexión.")
    } finally {
      if (!isLocalMode) {
        setIsSyncing(false)
      }
    }
  }

  // === FUNCIÓN DE NOTIFICACIONES ===
  const showNotification = async (message: string) => {
    try {
      if (Platform.OS === "web") {
        if (window.Notification && Notification.permission !== "denied") {
          const permission = await Notification.requestPermission()
          if (permission === "granted") {
            new Notification("QR Scanner", {
              body: message,
            })
          } else {
            Alert.alert("QR Scanner", message)
          }
        } else {
          Alert.alert("QR Scanner", message)
        }
      } else {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "QR Scanner",
            body: message,
          },
          trigger: null,
        })
      }
    } catch (error) {
      console.error("Error mostrando notificación:", error)
      Alert.alert("QR Scanner", message)
    }
  }

  // === FUNCIÓN PARA LIMPIAR HISTORIAL ===
  const clearScannedCodes = async () => {
    Alert.alert("Limpiar Historial", "¿Estás seguro de que quieres eliminar todos los códigos escaneados?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Eliminar",
        style: "destructive",
        onPress: async () => {
          if (db) {
            try {
              await db.limpiarCodigos()
              await updateData(db)
              Alert.alert("Éxito", "Historial limpiado")
            } catch (error) {
              console.error("Error limpiando códigos:", error)
              Alert.alert("Error", "No se pudo limpiar el historial")
            }
          }
        },
      },
    ])
  }

  // === FUNCIÓN PARA ELIMINAR CÓDIGO INDIVIDUAL ===
  const deleteCode = async (id: string) => {
    if (db) {
      try {
        await db.eliminarCodigo(id)
        await updateData(db)
      } catch (error) {
        console.error("Error eliminando código:", error)
        Alert.alert("Error", "No se pudo eliminar el código")
      }
    }
  }

  // === VERIFICACIÓN DE PERMISOS ===
  if (!permission) {
    return <View style={styles.container} />
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Se requiere permiso de cámara para usar esta app.</Text>
        <Button title="Conceder Permiso" onPress={requestPermission} />
      </View>
    )
  }

  // === PREPARACIÓN DE DATOS ===
  let locationText = "Esperando ubicación..."
  if (errorMsg) {
    locationText = errorMsg
  } else if (location) {
    locationText = `Lat: ${location.coords.latitude.toFixed(4)}, Long: ${location.coords.longitude.toFixed(4)}`
  }

  // === COMPONENTE PARA ITEMS DE LA LISTA ===
  const ScannedItem = ({ item }: { item: ScannedCode }) => {
    const onCopyPress = () => {
      Clipboard.setStringAsync(item.data)
      Alert.alert("Copiado", "Texto copiado al portapapeles")
    }

    const onDeletePress = () => {
      Alert.alert("Eliminar", "¿Estás seguro de que quieres eliminar este código?", [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: () => deleteCode(item.id),
        },
      ])
    }

    return (
      <View style={styles.itemContainer}>
        <View style={styles.itemContent}>
          <Text style={styles.itemData} numberOfLines={2}>
            {item.data}
          </Text>
          <Text style={styles.itemType}>{item.type}</Text>
          {item.timestamp && <Text style={styles.itemTime}>{new Date(item.timestamp).toLocaleString()}</Text>}
        </View>
        <View style={styles.itemActions}>
          <TouchableOpacity style={styles.copyButton} onPress={onCopyPress}>
            <Ionicons name="copy-outline" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.deleteButton} onPress={onDeletePress}>
            <Ionicons name="trash-outline" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>QR Scanner {isLocalMode ? "(Modo Local)" : ""}</Text>
        <Text style={styles.subtitle}>{locationText}</Text>

        {/* Estadísticas */}
        <View style={styles.statsContainer}>
          <Text style={styles.statsText}>Total: {stats.total}</Text>
          {stats.ultimoEscaneo && (
            <Text style={styles.statsText}>Último: {new Date(stats.ultimoEscaneo).toLocaleTimeString()}</Text>
          )}
        </View>

        {/* Indicador de estado de escaneo */}
        <View style={styles.statusContainer}>
          <View
            style={[styles.statusIndicator, { backgroundColor: isProcessingRef.current ? "#f39c12" : "#27ae60" }]}
          />
          <Text style={styles.statusText}>{isProcessingRef.current ? "Procesando..." : "Listo para escanear"}</Text>
        </View>
      </View>

      {/* Cámara */}
      <CameraView
        facing={facing}
        style={styles.cameraView}
        barcodeScannerSettings={{
          barcodeTypes: ["qr", "code128", "datamatrix", "aztec"],
        }}
        onBarcodeScanned={onBarcodeScanned}
      >
        {/* Overlay de escaneo */}
        <View style={styles.scanFrame}>
          <View style={styles.scanCorner} />
        </View>

        {/* Indicador de procesamiento */}
        {isProcessingRef.current && (
          <View style={styles.scanOverlay}>
            <ActivityIndicator size="large" color="#fff" />
            <Text style={styles.scanText}>Procesando código...</Text>
          </View>
        )}
      </CameraView>

      {/* Botones */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.button} onPress={() => showNotification("Prueba de notificación")}>
          <Ionicons name="notifications-outline" size={20} color="#fff" />
          <Text style={styles.buttonText}>Notificaciones</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.button, styles.syncButton]} onPress={syncWithServer} disabled={isSyncing}>
          {isSyncing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="cloud-upload-outline" size={20} color="#fff" />
              <Text style={styles.buttonText}>Sincronizar</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={() => setFacing(facing === "back" ? "front" : "back")}>
          <Ionicons name="camera-reverse-outline" size={20} color="#fff" />
          <Text style={styles.buttonText}>Voltear</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.clearButton]}
          onPress={clearScannedCodes}
          disabled={scannedCodes.length === 0}
        >
          <Ionicons name="trash-outline" size={20} color="#fff" />
          <Text style={styles.buttonText}>Limpiar</Text>
        </TouchableOpacity>
      </View>

      {/* Lista de códigos */}
      <View style={styles.listContainer}>
        <Text style={styles.listTitle}>Códigos Escaneados ({stats.total})</Text>

        {scannedCodes.length > 0 ? (
          <FlatList
            data={scannedCodes}
            keyExtractor={(item) => item.id}
            renderItem={ScannedItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="scan-outline" size={48} color="#ccc" />
            <Text style={styles.emptyText}>No hay códigos escaneados</Text>
            <Text style={styles.emptySubtext}>Apunta la cámara hacia un código QR o código de barras</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  header: {
    backgroundColor: "#007074",
    padding: 16,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 16 : 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#fff",
  },
  subtitle: {
    fontSize: 14,
    color: "#e6f2ff",
    marginTop: 4,
  },
  statsContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  statsText: {
    fontSize: 12,
    color: "#e6f2ff",
  },
  statusContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  statusText: {
    fontSize: 12,
    color: "#e6f2ff",
  },
  cameraView: {
    backgroundColor: "#000",
    width: "85%",
    height: 280,
    borderWidth: 2,
    borderColor: "#007074",
    borderRadius: 20,
    overflow: "hidden",
    alignSelf: "center",
    marginVertical: 16,
    position: "relative",
  },
  scanFrame: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 200,
    height: 200,
    marginTop: -100,
    marginLeft: -100,
    borderWidth: 2,
    borderColor: "#00ff00",
    borderRadius: 10,
  },
  scanCorner: {
    position: "absolute",
    top: -2,
    left: -2,
    width: 20,
    height: 20,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderColor: "#00ff00",
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  scanText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
    marginTop: 10,
  },
  buttonContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  button: {
    flex: 1,
    marginHorizontal: 2,
    backgroundColor: "#00879E",
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 50,
  },
  syncButton: {
    backgroundColor: "#328E6E",
  },
  clearButton: {
    backgroundColor: "#e74c3c",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 10,
    marginTop: 2,
  },
  listContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  listTitle: {
    fontSize: 18,
    fontWeight: "bold",
    padding: 16,
    backgroundColor: "#f9f9f9",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
  },
  listContent: {
    padding: 8,
  },
  itemContainer: {
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    marginVertical: 4,
    marginHorizontal: 8,
    flexDirection: "row",
    overflow: "hidden",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  itemContent: {
    flex: 1,
    padding: 12,
  },
  itemData: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 4,
  },
  itemType: {
    fontSize: 12,
    color: "#666",
    marginBottom: 2,
  },
  itemTime: {
    fontSize: 10,
    color: "#999",
  },
  itemActions: {
    flexDirection: "column",
  },
  copyButton: {
    backgroundColor: "#71BBB2",
    justifyContent: "center",
    alignItems: "center",
    width: 50,
    flex: 1,
  },
  deleteButton: {
    backgroundColor: "#e74c3c",
    justifyContent: "center",
    alignItems: "center",
    width: 50,
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  emptyText: {
    fontSize: 16,
    color: "#999",
    marginTop: 16,
    textAlign: "center",
  },
  emptySubtext: {
    fontSize: 14,
    color: "#ccc",
    marginTop: 8,
    textAlign: "center",
  },
})