const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Run this once in your PostgreSQL terminal/pgAdmin to create the table:
/*
CREATE TABLE clients (
    id SERIAL PRIMARY KEY,
    client_name VARCHAR(255) NOT NULL,
    client_email VARCHAR(255) UNIQUE NOT NULL,
    broker_email VARCHAR(255) NOT NULL,
    encrypted_refresh_token TEXT,
    is_active BOOLEAN DEFAULT true
);
*/

module.exports = {
    query: (text, params) => pool.query(text, params),
};