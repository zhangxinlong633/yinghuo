/** Substitute ${VAR} from env; unknown names left as-is. */
export function interpolateEnv(text: string, env: Record<string, string | undefined> = process.env): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (all, name: string) => {
    const v = env[name];
    return v === undefined ? all : v;
  });
}
