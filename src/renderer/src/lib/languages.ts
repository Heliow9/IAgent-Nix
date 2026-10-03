const languages: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  json: 'json', md: 'markdown', mmd: 'markdown', css: 'css', html: 'html',
  py: 'python', rs: 'rust', go: 'go', java: 'java', cs: 'csharp',
  yml: 'yaml', yaml: 'yaml', xml: 'xml', sh: 'shell', ps1: 'powershell',
  sql: 'sql', toml: 'ini', env: 'ini'
}

export function languageForPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase() ?? ''
  return languages[extension] ?? 'plaintext'
}
