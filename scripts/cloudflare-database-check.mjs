import {openPostgres} from '../backend/services/postgres.ts';
import {readinessFailure} from '../backend/services/diagnostics.ts';
const database=openPostgres(process.env.DATABASE_URL);
try {
  await database.ready;
  await database.db.prepare('SELECT 1').bind().first();
  console.log('Application database credentials, verified TLS and migration checks passed on the deployment runner.');
} catch(error) {
  console.error('Application database preflight failed',readinessFailure(error));
  process.exitCode=1;
} finally {await database.close();}
