import { Suspense }         from "react";
import { getList }          from "@frappe-next/core/server";
import styles               from "./page.module.css";

export const revalidate = 60;

interface FrappeUser {
  name:      string;
  full_name: string;
  user_type: string;
  enabled:   number;
}

async function UserTable() {
  const users = await getList<FrappeUser>("User", {
    fields:  ["name", "full_name", "user_type", "enabled"],
    filters: [["User", "enabled", "=", 1]],
    limit:   20,
  });

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          {["Email", "Full Name", "Type"].map((h) => (
            <th key={h} className={styles.th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {users.map((u) => (
          <tr key={u.name} className={styles.tr}>
            <td className={styles.tdMono}>{u.name}</td>
            <td className={styles.td}>{u.full_name}</td>
            <td className={styles.tdMuted}>{u.user_type}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function HomePage() {
  return (
    <main className={styles.container}>
      <h1>Frappe Next Bridge</h1>
      <p className={styles.subtitle}>
        Users fetched via <strong>SSR + ISR</strong> (revalidates every 60s)
      </p>
      <Suspense fallback={<p>Loading users from Frappe...</p>}>
        <UserTable />
      </Suspense>
    </main>
  );
}
