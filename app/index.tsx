import { useState, useEffect } from "react";
import { Text,View,StyleSheet,Button,FlatList,TouchableOpacity,ActivityIndicator,Alert,SafeAreaView,StatusBar,Platform } from "react-native";
import { Ionicons } from '@expo/vector-icons';


import * as Location from "expo-location";  // Para acceder a la ubicación GPS
import * as Clipboard from "expo-clipboard";  // Para copiar al portapapeles
import { CameraView, CameraType, useCameraPermissions, BarcodeScanningResult } from "expo-camera";  // Para la cámara y escaneo
import * as Notifications from "expo-notifications";  // Para mostrar notificaciones

// Importamos nuestras clases de base de datos local
import { connectDb, Database } from "../src/database";
import { ScannedCode } from "../src/models";

// === CONFIGURACIÓN DE MODO LOCAL ===
// Cambiar esta variable a false cuando se quiera conectar al servidor
const isLocalMode = true;

// URL del servidor web - Solo se usará si isLocalMode es false
const API_URL = 'http://localhost:3000'; 

// Configuración del manejador de notificaciones
Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldPlaySound: true,  // Reproducir sonido al mostrar notificación
        shouldSetBadge: false,  // No mostrar badge en el icono de la app
        shouldShowBanner: true, // Mostrar banner de notificación
        shouldShowList: true    // Mostrar en el centro de notificaciones
    })
});

// Componente principal de la aplicación
export default () => {
    // === ESTADOS ===
    // Estado para almacenar la ubicación actual
    const [location, setLocation] = useState<Location.LocationObject | null>(null);
    // Estado para almacenar mensajes de error
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    // Estado para controlar qué cámara usar (frontal o trasera)
    const [facing, setFacing] = useState<CameraType>("back");
    // Hook para manejar permisos de cámara
    const [permission, requestPermission] = useCameraPermissions();
    // Estado para almacenar los códigos escaneados
    const [scannedCodes, setScannedCodes] = useState<ScannedCode[]>([]);
    // Estado para almacenar la conexión a la base de datos
    const [db, setDB] = useState<Database>();
    // Estado para controlar si estamos escaneando o no
    const [isScanning, setIsScanning] = useState(true);
    // Estado para mostrar indicador de sincronización
    const [isSyncing, setIsSyncing] = useState(false);

    // === EFECTOS ===
    useEffect(() => {
        // Función para obtener la ubicación actual
        async function getCurrentLocation() {
            // Solicitar permisos de ubicación
            let { status } = await Location.requestForegroundPermissionsAsync();
            if (status !== 'granted') {
                setErrorMsg('Permission to access location was denied');
                return;
            }

            // Obtener la ubicación actual
            let location = await Location.getCurrentPositionAsync({});
            setLocation(location);
        }
        
        // Función para obtener datos de la base de datos local
        async function retrieveLocalDbData() {
            const db = await connectDb();
            setDB(db);
            setScannedCodes(await db.consultarCodigos());
        }
        
        // Ejecutar ambas funciones al iniciar
        getCurrentLocation();
        retrieveLocalDbData();
    }, []); // El array vacío significa que solo se ejecuta una vez al montar

    // === FUNCIONES ===
    // Función para sincronizar códigos con el servidor
    const syncWithServer = async () => {
        // Verificar si hay códigos para sincronizar
        if (!scannedCodes.length) {
            Alert.alert("Sincronización", "No hay códigos para sincronizar");
            return;
        }
        
        // Activar indicador de sincronización
        setIsSyncing(true);
        
        try {
            // === VERIFICACIÓN DE MODO LOCAL ===
            // Si estamos en modo local, mostrar mensaje informativo y salir
            if (isLocalMode) {
                setTimeout(() => {
                    Alert.alert(
                        "Modo Local", 
                        "Estás trabajando en modo local. La sincronización con el servidor no está disponible."
                    );
                    setIsSyncing(false); // Desactivar indicador de sincronización
                }, 500); // Pequeño retraso para mostrar el spinner brevemente
                return;
            }
            
            // Si no estamos en modo local, procedemos con la sincronización
            // Enviamos cada código al servidor
            for (const code of scannedCodes) {
                // Realizar petición POST al servidor
                await fetch(`${API_URL}/codigos`, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json;encoding=utf-8',
                        'Content-Type': 'application/json;encoding=utf-8'
                    },
                    body: JSON.stringify({
                        data: code.data,
                        type: code.type
                    })
                });
            }
            
            // Mostrar mensaje de éxito
            Alert.alert(
                "Sincronización Exitosa", 
                `Se han sincronizado ${scannedCodes.length} códigos con el servidor`
            );
        } catch (error) {
            // Manejar errores de sincronización
            console.error("Error al sincronizar:", error);
            Alert.alert(
                "Error de Sincronización", 
                "No se pudieron sincronizar los códigos. Verifica tu conexión."
            );
        } finally {
            // Desactivar indicador de sincronización si no se hizo antes
            if (!isLocalMode) {
                setIsSyncing(false);
            }
        }
    };

    // === VERIFICACIÓN DE PERMISOS ===
    // Si aún no se han solicitado permisos, mostrar vista vacía
    if (!permission) {
        return <View style={styles.container} />;
    }
    
    // Si no se han concedido permisos, mostrar botón para solicitarlos
    if (!permission.granted) {
        return (
            <View style={styles.container}>
                <Text style={styles.title}>Se requiere permiso de cámara para usar esta app.</Text>
                <Button title="Conceder Permiso" onPress={requestPermission} />
            </View>
        );
    }

    // === PREPARACIÓN DE DATOS PARA LA UI ===
    // Formatear texto de ubicación para mostrar
    let locationText = 'Esperando ubicación...';
    if (errorMsg) {
        locationText = errorMsg;
    }
    else if (location) {
        locationText = `Lat: ${location.coords.latitude.toFixed(4)}, Long: ${location.coords.longitude.toFixed(4)}`;
    }

    // Función que se ejecuta cuando se escanea un código
    const onBarcodeScanned = async function (result: BarcodeScanningResult) {
        // Evitamos escaneos múltiples verificando el estado
        if (!isScanning) return;
        
        // Desactivamos el escaneo temporalmente
        setIsScanning(false);
        
        // Mostramos una notificación con el código escaneado
        await showNotification(`Código escaneado: ${result.data}`);
        
        // Guardamos en la base de datos local
        if (db) {
            await db.insertarCodigo(result.data, result.type);
            setScannedCodes(await db.consultarCodigos());
        }
        
        // Reactivamos el escaneo después de 2 segundos
        setTimeout(() => {
            setIsScanning(true);
        }, 2000);
    }

    // Función para mostrar notificaciones
    const showNotification = async function (message: string) {
        try {
            // Verificamos si estamos en web
            if (Platform.OS === 'web') {
                // En web usamos la API de Notification del navegador
                if (window.Notification && Notification.permission !== 'denied') {
                    const permission = await Notification.requestPermission();
                    if (permission === 'granted') {
                        new Notification('QR Scanner', {
                            body: message
                        });
                    } else {
                        Alert.alert('QR Scanner', message);
                    }
                } else {
                    Alert.alert('QR Scanner', message);
                }
            } else {
                // En dispositivos móviles usamos Expo Notifications
                await Notifications.scheduleNotificationAsync({
                    content: {
                        title: "QR Scanner",
                        body: message,
                    },
                    trigger: null, // null significa mostrar inmediatamente
                });
            }
        } catch (error) {
            // Si hay error, mostramos una alerta como fallback
            console.error('Error mostrando notificación:', error);
            Alert.alert('QR Scanner', message);
        }
    };

    // Componente para renderizar cada item en la lista de códigos
    const ScannedItem = function ({ item }: { item: ScannedCode }) {
        // Función para copiar el código al portapapeles
        const onCopyPress = function() {
            Clipboard.setStringAsync(item.data);
            Alert.alert("Copiado", "Texto copiado al portapapeles");
        };
        
        // Renderizado del item
        return (
            <View style={styles.itemContainer}>
                <View style={styles.itemContent}>
                    <Text style={styles.itemData}>{item.data}</Text>
                    <Text style={styles.itemType}>{item.type}</Text>
                </View>
                <TouchableOpacity style={styles.copyButton} onPress={onCopyPress}>
                    <Ionicons name="copy-outline" size={24} color="#fff" />
                </TouchableOpacity>
            </View>
        )
    }
    
    // === RENDERIZADO PRINCIPAL ===
    return (
        <SafeAreaView style={styles.container}>
            {/* Barra de estado */}
            <StatusBar barStyle="light-content" />
            
            {/* Cabecera con título y ubicación */}
            <View style={styles.header}>
                <Text style={styles.title}>QR Scanner {isLocalMode ? "(Modo Local)" : ""}</Text>
                <Text style={styles.subtitle}>{locationText}</Text>
            </View>
            
            {/* Vista de cámara para escaneo */}
            <CameraView 
                facing={facing} 
                style={styles.cameraView}
                barcodeScannerSettings={{
                    barcodeTypes: ['qr', "code128", "datamatrix", "aztec"]
                }}
                onBarcodeScanned={isScanning ? onBarcodeScanned : undefined}
            >
                {/* Overlay que se muestra cuando se detecta un código */}
                {!isScanning && (
                    <View style={styles.scanOverlay}>
                        <Text style={styles.scanText}>Código detectado</Text>
                    </View>
                )}
            </CameraView>
            
            {/* Contenedor de botones */}
            <View style={styles.buttonContainer}>
                {/* Botón de notificación */}
                <TouchableOpacity 
                    style={styles.button} 
                    onPress={() => showNotification("Prueba de notificación")}
                >
                    <Ionicons name="notifications-outline" size={24} color="#fff" />
                    <Text style={styles.buttonText}>Notificación</Text>
                </TouchableOpacity>
                
                {/* Botón de sincronización - Se mantiene visible incluso en modo local */}
                <TouchableOpacity 
                    style={[styles.button, styles.syncButton]} 
                    onPress={syncWithServer}
                    disabled={isSyncing}
                >
                    {isSyncing ? (
                        <ActivityIndicator color="#fff" />
                    ) : (
                        <>
                            <Ionicons name="cloud-upload-outline" size={24} color="#fff" />
                            <Text style={styles.buttonText}>Sincronizar</Text>
                        </>
                    )}
                </TouchableOpacity>
                
                {/* Botón para cambiar de cámara */}
                <TouchableOpacity 
                    style={styles.button} 
                    onPress={() => setFacing(facing === 'back' ? 'front' : 'back')}
                >
                    <Ionicons name="camera-reverse-outline" size={24} color="#fff" />
                    <Text style={styles.buttonText}>Cambiar</Text>
                </TouchableOpacity>
            </View>
            
            {/* Contenedor de la lista de códigos */}
            <View style={styles.listContainer}>
                <Text style={styles.listTitle}>
                    Códigos Escaneados ({scannedCodes.length})
                </Text>
                
                {/* Lista de códigos o mensaje si no hay códigos */}
                {scannedCodes.length > 0 ? (
                    <FlatList 
                        data={scannedCodes}
                        keyExtractor={(item) => item.id}
                        renderItem={ScannedItem}
                        contentContainerStyle={styles.listContent}
                    />
                ) : (
                    <View style={styles.emptyContainer}>
                        <Ionicons name="scan-outline" size={48} color="#ccc" />
                        <Text style={styles.emptyText}>No hay códigos escaneados</Text>
                    </View>
                )}
            </View>
        </SafeAreaView>
    );
}

// === ESTILOS ===
const styles = StyleSheet.create({
    // Los estilos se mantienen igual que en la versión anterior
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
    header: {
        backgroundColor: '#007074',
        padding: 16,
        paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 0 + 16 : 16,
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#fff',
    },
    subtitle: {
        fontSize: 14,
        color: '#e6f2ff',
        marginTop: 4,
    },
    cameraView: {
        backgroundColor: '#000',
        width: "80%",
        height: 300,
        borderWidth: 2,
        borderColor: '#007074',
        borderStyle: 'solid',
        borderRadius: 30,
        overflow: 'hidden',
        alignSelf: 'center',     // Centrado horizontal
        marginVertical: 'auto',  // Centrado vertical
        marginTop: 16,
        marginBottom: 16,
    },
    scanOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    scanText: {
        color: '#fff',
        fontSize: 18,
        fontWeight: 'bold',
    },
    buttonContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between', 
        alignItems: 'center',
        padding: 12,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    button: {
        flex: 1, 
        marginHorizontal: 4,
        backgroundColor: '#00879E',
        paddingVertical: 10,
        paddingHorizontal: 8,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column', 
    },
    syncButton: {
        backgroundColor: '#27ae60',
    },
    buttonText: {
        color: '#fff',
        fontWeight: 'bold',
        marginLeft: 8,
    },
    listContainer: {
        flex: 1,
        backgroundColor: '#fff',
    },
    listTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        padding: 16,
        backgroundColor: '#f9f9f9',
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    listContent: {
        padding: 8,
    },
    itemContainer: {
        backgroundColor: '#f9f9f9',
        borderRadius: 8,
        marginVertical: 6,
        marginHorizontal: 8,
        flexDirection: 'row',
        overflow: 'hidden',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
    },
    itemContent: {
        flex: 1,
        padding: 16,
    },
    itemData: {
        fontSize: 16,
        fontWeight: '500',
    },
    itemType: {
        fontSize: 12,
        color: '#666',
        marginTop: 4,
    },
    copyButton: {
        backgroundColor: '#71BBB2',
        justifyContent: 'center',
        alignItems: 'center',
        width: 50,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    emptyText: {
        fontSize: 16,
        color: '#999',
        marginTop: 16,
    }
});