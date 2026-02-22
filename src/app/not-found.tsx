import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "600px", margin: "auto", textAlign: "center" }}>
      <h1 style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>404</h1>
      <h2 style={{ color: "#57534e", marginBottom: "1rem" }}>Page not found</h2>
      <p style={{ color: "#a8a29e", marginBottom: "2rem" }}>
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link
        href="/"
        style={{
          display: "inline-block",
          padding: "0.75rem 1.5rem",
          backgroundColor: "#292524",
          color: "#fff",
          borderRadius: "0.375rem",
          textDecoration: "none",
          fontSize: "1rem",
        }}
      >
        Go home
      </Link>
    </main>
  );
}
