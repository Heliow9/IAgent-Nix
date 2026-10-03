const languages: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', md: 'markdown', mmd: 'markdown', css: 'css', html: 'html',
  py: 'python', rs: 'rust', go: 'go', java: 'java', cs: 'csharp',
  yml: 'yaml', yaml: 'yaml', xml: 'xml', sh: 'shell', ps1: 'powershell',
  sql: 'sql', toml: 'ini', env: 'ini', prisma: 'plaintext' 
}

export function languageForPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return languages[extension] ?? 'plaintext'
}
