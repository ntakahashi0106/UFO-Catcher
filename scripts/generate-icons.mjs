// Resize the imagegen source; never recreate the former H mark.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(process.env.PYTHON || 'python', [
  fileURLToPath(new URL('./generate-icons.py', import.meta.url)),
], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
