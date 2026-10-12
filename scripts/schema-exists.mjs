import pg from 'pg';
import { postgresConfig } from '../backend/services/postgres.ts';
const pool=new pg.Pool(postgresConfig(process.env.DATABASE_URL));
try {
 const result=await pool.query("SELECT to_regclass('schema_migrations') AS name");
 process.exitCode=result.rows[0].name?0:42;
}finally{await pool.end();}
