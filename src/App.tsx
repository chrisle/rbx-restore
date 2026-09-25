import { RestorePane } from "@/views/RestorePane";
import styles from "./App.module.css";

export function App() {
  return <main className={styles.window}>
    <header className={styles.titleBar} data-tauri-drag-region>
      <span>RBXport Restore</span>
    </header>
    <div className={styles.scroller}>
      <RestorePane />
    </div>
  </main>;
}
