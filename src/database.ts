import * as SQLite from "expo-sqlite";
import { ScannedCode } from "./models"


export async function connectDb()
{
    return new Database(await SQLite.openDatabaseAsync('ScanQR')); 
}

export class Database {

    constructor(private db:SQLite.SQLiteDatabase){
        this.init();
    }
    close () {
        this.db.closeAsync();
    }
    private async init(){
        
        await this.db.execAsync(
            `CREATE TABLE IF NOT EXISTS codigos (
                id TEXT PRIMARY KEY NOT NULL DEFAULT (lower(hex(randomblob(16)))),
                data TEXT NOT NULL DEFAULT '',
                type TEXT NOT NULL DEFAULT 'qr'
            );`
        );
    }

    async dropDB()
    {
        await this.db.execAsync('DROP TABLE IF EXISTS codigos;')
    }

    async insertarCodigo(data:string,type:string) 
    {
        const result = await this.db.runAsync(
            'INSERT INTO codigos (data, type) VALUES (?,?)', data, type 
        );
        return result;
    }

    async consultarCodigos(){
        const result = await this.db.getAllAsync<ScannedCode>(
            'SELECT * FROM codigos'
        );
        return result; 
    }


}

