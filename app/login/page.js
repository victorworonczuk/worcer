export default async function LoginPage({ searchParams }) {
  const params = await searchParams;
  const hasError = params?.error === '1';

  return (
    <div style={styles.page}>
      <img src="/icons/logo-worcer.jpg" alt="Worcer" style={styles.logo} />
      <form method="POST" action="/api/login" style={styles.card}>
        <p style={styles.subtitle}>Panel de gestión de clientes</p>

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
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '24px',
    background: '#408CC8',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  logo: {
    height: '90px',
    width: 'auto',
    borderRadius: '6px',
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
  subtitle: {
    margin: '0 0 24px',
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
    background: '#2e6ea0',
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
