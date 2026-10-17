// Local SQLite is intentionally excluded from the Workers bundle.
export class DatabaseSync { constructor(){throw Error('SQLite is unavailable in Workers. Configure PostgreSQL.');} }
