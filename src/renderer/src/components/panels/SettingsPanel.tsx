import { useEffect, useState } from 'react'
import type { GroqQuotaSnapshot, McpServerConfig, NixSettings, SkillInfo } from '../../../../shared/contracts'

export function SettingsPanel(): React.JSX.Element {
  const [settings, setSettings] = useState<NixSettings>()
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [servers, setServers] = useState<McpServerConfig[]>([])
  const [quota, setQuota] = useState<GroqQuotaSnapshot>()
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void Promise.all([window.desktop.settings.get(), window.desktop.skills.reload(), window.desktop.mcp.servers()])
      .then(([s, k, m]) => {
        setSettings(s)
        setSkills(k)
        setServers(m.map(({ connected: _c, error: _e, toolCount: _t, ...x }) => x))
      })
    const refreshQuota = (): void => { void window.desktop.groq?.quota().then(setQuota).catch(() => undefined) }
    refreshQuota()
    const timer = window.setInterval(refreshQuota, 5_000)
    return () => window.clearInterval(timer)
  }, [])

  if (!settings) return <div className="empty-panel">Carregando configurações…</div>

  const save = async (): Promise<void> => {
    setSettings(await window.desktop.settings.update(settings))
    await window.desktop.mcp.configure(servers)
    setQuota(await window.desktop.groq?.quota().catch(() => undefined))
    setSaved(true)
    setTimeout(() => setSaved(false), 1_500)
  }

  const useFree120Preset = (): void => setSettings({
    ...settings,
    fastModel: 'openai/gpt-oss-120b',
    deepModel: 'openai/gpt-oss-120b',
    reasoningMode: 'auto',
    groqFreeTierMode: true,
    quotaProtection: 'adaptive',
    contextTokenBudget: 3_600,
    maxCompletionTokens: 2_200,
    maxConcurrentRuns: 1,
    groqDailyTokenLimit: 200_000
  })

  return <div className="side-tool-panel settings-panel">
    <section className="settings-section settings-hero">
      <div><strong>Groq + GPT-OSS</strong><small>Perfil otimizado para o NIX no Free Tier</small></div>
      <button className="secondary-button subtle" onClick={useFree120Preset}>Usar preset 120B Free</button>
    </section>

    <QuotaCard quota={quota} />

    <section className="settings-section">
      <h4>Modelos e raciocínio</h4>
      <label>Modelo rápido<input value={settings.fastModel} onChange={e => setSettings({ ...settings, fastModel: e.target.value })} /></label>
      <label>Modelo profundo<input value={settings.deepModel} onChange={e => setSettings({ ...settings, deepModel: e.target.value })} /></label>
      <label>Raciocínio<select value={settings.reasoningMode} onChange={e => setSettings({ ...settings, reasoningMode: e.target.value as NixSettings['reasoningMode'] })}>
        <option value="auto">Automático — recomendado</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
      </select></label>
      <label>Roteamento<select value={settings.modelRouting} onChange={e => setSettings({ ...settings, modelRouting: e.target.value as NixSettings['modelRouting'] })}>
        <option value="auto">Automático</option><option value="fast">Sempre rápido</option><option value="deep">Sempre profundo</option>
      </select></label>
    </section>

    <section className="settings-section">
      <h4>Proteção do Free Tier</h4>
      <label className="toggle-row"><input type="checkbox" checked={settings.groqFreeTierMode} onChange={e => setSettings({ ...settings, groqFreeTierMode: e.target.checked, maxConcurrentRuns: e.target.checked ? 1 : settings.maxConcurrentRuns })} /> Modo Groq Free Tier</label>
      <label>Proteção de quota<select value={settings.quotaProtection} onChange={e => setSettings({ ...settings, quotaProtection: e.target.value as NixSettings['quotaProtection'] })}>
        <option value="adaptive">Adaptativa — reduz esforço quando necessário</option><option value="monitor">Somente monitorar</option><option value="off">Desativada</option>
      </select></label>
      <label>Orçamento de contexto (tokens)<input type="number" min={800} max={100000} step={100} value={settings.contextTokenBudget} onChange={e => setSettings({ ...settings, contextTokenBudget: Number(e.target.value) })} /></label>
      <label>Máximo de saída/raciocínio (tokens)<input type="number" min={400} max={65536} step={100} value={settings.maxCompletionTokens} onChange={e => setSettings({ ...settings, maxCompletionTokens: Number(e.target.value) })} /></label>
      <label>Limite diário usado no monitor<input type="number" min={10000} step={10000} value={settings.groqDailyTokenLimit} onChange={e => setSettings({ ...settings, groqDailyTokenLimit: Number(e.target.value) })} /></label>
      <small>O monitor diário é estimado localmente. Os limites RPD/TPM exibidos acima vêm dos headers da Groq quando disponíveis.</small>
    </section>

    <section className="settings-section">
      <h4>Agente</h4>
      <label>Contexto máximo legado (caracteres)<input type="number" value={settings.contextMaxCharacters} onChange={e => setSettings({ ...settings, contextMaxCharacters: Number(e.target.value) })} /></label>
      <label>Execuções simultâneas<input type="number" min={1} max={settings.groqFreeTierMode ? 1 : 8} disabled={settings.groqFreeTierMode} value={settings.maxConcurrentRuns} onChange={e => setSettings({ ...settings, maxConcurrentRuns: Number(e.target.value) })} /></label>
      {settings.groqFreeTierMode && <small>No Free Tier o NIX fixa 1 execução simultânea para evitar colisão no TPM.</small>}
      <label className="toggle-row"><input type="checkbox" checked={settings.autoVerify} onChange={e => setSettings({ ...settings, autoVerify: e.target.checked })} /> Verificação automática</label>
      <label className="toggle-row"><input type="checkbox" checked={settings.superpowersEnabled} onChange={e => setSettings({ ...settings, superpowersEnabled: e.target.checked })} /> Skills/Superpowers</label>
    </section>

    <section className="settings-section">
      <h4>Skills carregadas</h4>
      <div className="skills-list">{skills.map(s => <span key={s.id}>✓ {s.name}<small>{s.source}</small></span>)}</div>
    </section>

    <section className="settings-section">
      <h4>MCP</h4>
      {servers.map((srv, i) => <div className="mcp-row" key={srv.id}>
        <input value={srv.name} onChange={e => setServers(servers.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
        <input value={srv.command} placeholder="comando" onChange={e => setServers(servers.map((x, j) => j === i ? { ...x, command: e.target.value } : x))} />
        <button onClick={() => setServers(servers.filter((_, j) => j !== i))}>×</button>
      </div>)}
      <button className="secondary-button subtle" onClick={() => setServers([...servers, { id: crypto.randomUUID(), name: 'MCP', command: '', args: [], enabled: true }])}>+ Servidor MCP</button>
    </section>

    <button className="primary-button" onClick={() => void save()}>{saved ? 'Salvo' : 'Salvar configurações'}</button>
    <small>Alterações de concorrência/modelos podem exigir reinício para execuções já inicializadas.</small>
  </div>
}

function QuotaCard({ quota }: { quota?: GroqQuotaSnapshot }): React.JSX.Element {
  const rpdLimit = quota?.server.requestsPerDay.limit
  const rpdRemaining = quota?.server.requestsPerDay.remaining
  const tpmLimit = quota?.server.tokensPerMinute.limit
  const tpmRemaining = quota?.server.tokensPerMinute.remaining
  const dailyLimit = quota?.local.configuredDailyTokenLimit ?? 200_000
  const dailyUsed = quota?.local.estimatedTokensToday ?? 0
  return <section className="quota-card">
    <div className="quota-heading"><strong>Quota Groq</strong><span>{quota?.plan === 'free' ? 'FREE' : 'CUSTOM'}</span></div>
    <QuotaRow label="Requisições/dia" used={rpdLimit !== undefined && rpdRemaining !== undefined ? rpdLimit - rpdRemaining : undefined} limit={rpdLimit} />
    <QuotaRow label="Tokens/min" used={tpmLimit !== undefined && tpmRemaining !== undefined ? tpmLimit - tpmRemaining : undefined} limit={tpmLimit} detail={quota?.server.tokensPerMinute.reset ? `reset ${quota.server.tokensPerMinute.reset}` : undefined} />
    <QuotaRow label="Tokens/dia (estimado)" used={dailyUsed} limit={dailyLimit} />
    <div className="quota-foot"><span>Reasoning: {quota?.activeReasoning?.toUpperCase() ?? '—'}</span><span>{quota?.lastUpdatedAt ? new Date(quota.lastUpdatedAt).toLocaleTimeString('pt-BR') : 'aguardando primeira chamada'}</span></div>
  </section>
}

function QuotaRow({ label, used, limit, detail }: { label: string; used?: number; limit?: number; detail?: string }): React.JSX.Element {
  const percent = used !== undefined && limit ? Math.max(0, Math.min(100, (used / limit) * 100)) : 0
  return <div className="quota-row">
    <div><span>{label}</span><small>{used === undefined || limit === undefined ? '—' : `${formatNumber(used)} / ${formatNumber(limit)}`}{detail ? ` · ${detail}` : ''}</small></div>
    <div className="quota-track"><i style={{ width: `${percent}%` }} /></div>
  </div>
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR', { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}
