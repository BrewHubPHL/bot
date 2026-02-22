"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "600px", margin: "auto" }}>
        <h1 style={{ color: "#b91c1c" }}>Something went wrong</h1>
        <p style={{ color: "#57534e" }}>
          An unexpected error occurred. Please try again.
        </p>
        {error?.digest && (
          <p style={{ fontSize: "0.875rem", color: "#a8a29e" }}>
            Error ID: {error.digest}
          </p>
        )}
        <button
          onClick={() => reset()}
          style={{
            marginTop: "1rem",
            padding: "0.75rem 1.5rem",
            backgroundColor: "#292524",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            cursor: "pointer",
            fontSize: "1rem",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
