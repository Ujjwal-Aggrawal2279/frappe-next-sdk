"use client";

import { useState, type FormEvent }   from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { frappeClientPost }           from "@frappe-next/core/client";
import styles                         from "./login.module.css";


export default function LoginPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const nextPath     = searchParams.get("next") ?? "/";

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Frappe sets the `sid` cookie automatically on successful login
      // frappeClientPost returns data.message from Frappe envelope.
      // Frappe login response: {"message":"Logged In","home_page":"/app",...}
      // So result = "Logged In" (string), NOT an object with .message property.
      const result = await frappeClientPost<string>("login", {
        usr: email,
        pwd: password,
      });

      if (result === "Logged In") {
        router.push(nextPath);
        router.refresh(); // re-run Server Components with new session
      } else {
        setError("Login failed. Check your credentials.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.container}>
      <h1 className={styles.title}>Sign In</h1>
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.field}>
          <label htmlFor="email" className={styles.label}>Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={styles.input}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="password" className={styles.label}>Password</label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={styles.input}
          />
        </div>
        {error && <p className={styles.error}>{error}</p>}
        <button type="submit" disabled={loading} className={styles.button}>
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </form>
    </main>
  );
}
