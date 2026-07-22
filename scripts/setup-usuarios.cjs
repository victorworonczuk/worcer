const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

require('dotenv').config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });

const CONNECTION_STRING = process.env.DATABASE_URL;
if (!CONNECTION_STRING) {
  console.error('Falta DATABASE_URL en .env.local');
  process.exit(1);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

// Solo username/nombre/rol acá — nunca contraseñas reales en este archivo.
// Si el usuario ya existe, este script NO le toca la clave (solo crea los que faltan).
const USUARIOS = [
  { username: 'worcer', nombre: 'Víctor', rol: 'admin' },
  { username: 'facturacion', nombre: 'Facturación', rol: 'facturacion' },
  { username: 'ventas', nombre: 'Ventas', rol: 'ventas' },
  { username: 'mauricio', nombre: 'Mauricio', rol: 'facturacion' },
];

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();

  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema_usuarios.sql'), 'utf8');
  await client.query(schema);
  console.log('Tabla usuarios creada/verificada.\n');

  const { rows: existentes } = await client.query('select username from public.usuarios');
  const existentesSet = new Set(existentes.map((r) => r.username));

  const nuevos = USUARIOS.filter((u) => !existentesSet.has(u.username));
  if (nuevos.length === 0) {
    console.log('No hay usuarios nuevos para crear (todos los de la lista ya existen).');
    await client.end();
    return;
  }

  console.log('=== CREDENCIALES NUEVAS (guardalas ahora, no se vuelven a mostrar) ===');
  for (const u of nuevos) {
    const password = crypto.randomBytes(6).toString('base64url');
    const { salt, hash } = hashPassword(password);
    await client.query(
      `insert into public.usuarios (username, password_hash, salt, nombre, rol) values ($1, $2, $3, $4, $5)`,
      [u.username, hash, salt, u.nombre, u.rol]
    );
    console.log(`${u.nombre.padEnd(12)} | usuario: ${u.username.padEnd(14)} | clave: ${password}`);
  }
  console.log('========================================================================\n');

  await client.end();
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
