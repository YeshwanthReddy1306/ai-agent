const fs = require('fs');
const path = require('path');
const { pool } = require('../lib/db');

async function initDB() {
  try {
    console.log('Reading schema...');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    console.log('Executing schema on database...');
    await pool.query(schema);
    
    console.log('Database initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize database:', error);
  } finally {
    await pool.end();
  }
}

initDB();
