export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const hasError = params?.error === '1';

  return (
    <div style={styles.page}>
      <form method="POST" action="/api/login" style={styles.card}>
        <h1 style={styles.title}>Worcer</h1>
        <p style={styles.subtitle}>Panel de recupero de clientes</p>

        {hasError && <div style={styles.error}>Usuario o contraseña incorrectos.</div>}

        <label style={styles.label} htmlFor="username">Usuario</label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          required
          autoFocus
          style={styles.input}
        />

        <label style={styles.label} htmlFor="password">Contraseña</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          style={styles.input}
        />

        <button type="submit" style={styles.button}>Ingresar</button>
      </form>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f6f7f9',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  card: {
    background: '#ffffff',
    border: '1px solid #e3e6ea',
    borderRadius: '12px',
    boxShadow: '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.08)',
    padding: '32px',
    width: '320px',
    display: 'flex',
    flexDirection: 'column',
  },
  title: {
    margin: 0,
    fontSize: '22px',
    fontWeight: 700,
    color: '#1c2126',
  },
  subtitle: {
    margin: '4px 0 24px',
    fontSize: '13px',
    color: '#6b7280',
  },
  error: {
    background: '#fdecec',
    color: '#d64545',
    fontSize: '13px',
    padding: '8px 10px',
    borderRadius: '8px',
    marginBottom: '16px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#1c2126',
    marginBottom: '6px',
  },
  input: {
    border: '1px solid #e3e6ea',
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '14px',
    marginBottom: '16px',
    outline: 'none',
  },
  button: {
    background: '#2453ff',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 12px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: '4px',
  },
};
