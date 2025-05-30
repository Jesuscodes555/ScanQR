import * as SQLite from "expo-sqlite"
import type { ScannedCode } from "./models"

export async function connectDb() {
  return new Database(await SQLite.openDatabaseAsync("ScanQR"))
}

export class Database {
  constructor(private db: SQLite.SQLiteDatabase) {
    this.init()
  }

  close() {
    this.db.closeAsync()
  }

  private async init() {
    // Crear tabla inicial si no existe
    await this.db.execAsync(
      `CREATE TABLE IF NOT EXISTS codigos (
      id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
      data TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'qr'
    );`,
    )

    // Verificar si la columna timestamp existe y agregarla si no existe
    try {
      const tableInfo = await this.db.getAllAsync("PRAGMA table_info(codigos)")
      const hasTimestamp = tableInfo.some((column: any) => column.name === "timestamp")

      if (!hasTimestamp) {
        console.log("Agregando columna timestamp...")
        await this.db.execAsync(
          `ALTER TABLE codigos ADD COLUMN timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)`,
        )
        console.log("Columna timestamp agregada exitosamente")
      }
    } catch (error) {
      console.error("Error en migración:", error)
      // Si hay error, podemos recrear la tabla
      await this.recreateTable()
    }
  }

  // Función para recrear la tabla con el nuevo esquema  
  private async recreateTable() {
    try {
      console.log("Recreando tabla con nuevo esquema...")

      // Respaldar datos existentes
      const existingData = await this.db.getAllAsync<{ id: string; data: string; type: string }>(
        "SELECT * FROM codigos",
      )

      // Eliminar tabla existente
      await this.db.execAsync("DROP TABLE IF EXISTS codigos")

      // Crear nueva tabla con timestamp
      await this.db.execAsync(
        `CREATE TABLE codigos (
        id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
        data TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'qr',
        timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
      );`,
      )

      // Restaurar datos existentes con timestamp actual
      for (const row of existingData as Array<{ id: string; data: string; type: string }>) {
        await this.db.runAsync(
          "INSERT INTO codigos (id, data, type, timestamp) VALUES (?, ?, ?, ?)",
          row.id,
          row.data,
          row.type,
          Date.now(),
        )
      }

      console.log("Tabla recreada exitosamente")
    } catch (error) {
      console.error("Error recreando tabla:", error)
    }
  }

  async dropDB() {
    await this.db.execAsync("DROP TABLE IF EXISTS codigos;")
  }

  async insertarCodigo(data: string, type: string) {
    const result = await this.db.runAsync(
      "INSERT INTO codigos (data, type, timestamp) VALUES (?,?,?)",
      data,
      type,
      Date.now(),
    )
    return result
  }

  async consultarCodigos(): Promise<ScannedCode[]> {
    const result = await this.db.getAllAsync<ScannedCode>("SELECT * FROM codigos ORDER BY timestamp DESC")
    return result
  }

  // Nueva función para limpiar todos los códigos
  async limpiarCodigos(): Promise<void> {
    await this.db.runAsync("DELETE FROM codigos")
  }

  // Función para eliminar un código específico
  async eliminarCodigo(id: string): Promise<void> {
    await this.db.runAsync("DELETE FROM codigos WHERE id = ?", id)
  }

  // Función para verificar si un código ya existe (para evitar duplicados)
  async existeCodigo(data: string): Promise<boolean> {
    const result = await this.db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) as count FROM codigos WHERE data = ?",
      data,
    )
    return (result?.count || 0) > 0
  }

  // Función para obtener estadísticas
  async obtenerEstadisticas(): Promise<{
    total: number
    porTipo: { type: string; count: number }[]
    ultimoEscaneo: string | null
  }> {
    const total = await this.db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM codigos")

    const porTipo = await this.db.getAllAsync<{ type: string; count: number }>(
      "SELECT type, COUNT(*) as count FROM codigos GROUP BY type ORDER BY count DESC",
    )

    const ultimoEscaneo = await this.db.getFirstAsync<{ timestamp: number }>(
      "SELECT timestamp FROM codigos ORDER BY timestamp DESC LIMIT 1",
    )

    return {
      total: total?.count || 0,
      porTipo: porTipo || [],
      ultimoEscaneo: ultimoEscaneo ? new Date(ultimoEscaneo.timestamp).toISOString() : null,
    }
  }

  // Función pública para forzar migración
  async migrarEsquema(): Promise<void> {
    await this.recreateTable()
  }
}
