import { getDatabase } from '../database';
import { up } from './001_initial';

const db = getDatabase();
up(db);
console.log('Migrations complete.');
