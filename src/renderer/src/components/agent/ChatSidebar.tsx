import { useState } from 'react'

import type { ChatRecord } from '../../../../shared/contracts'

export function ChatSidebar({ chats, selectedChatId, onCreate, onSelect, onRename, onArchive }: {
  chats: ChatRecord[]
  selectedChatId?: string
  onCreate(): void
  onSelect(chatId: string): void
  onRename(chatId: string, title: string): void
  onArchive(chatId: string): void
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string>()
  const [title, setTitle] = useState('')
  const active = chats.filter((chat) => chat.status === 'active' && chat.title.toLowerCase().includes(query.toLowerCase()))
  const archived = chats.filter((chat) => chat.status === 'archived' && chat.title.toLowerCase().includes(query.toLowerCase()))

  if (collapsed) return <aside className="chat-sidebar collapsed"><button type="button" aria-label="Expandir conversas" onClick={() => setCollapsed(false)}>☰</button></aside>
  return <aside className="chat-sidebar">
    <header><strong>Conversas</strong><button type="button" aria-label="Recolher conversas" onClick={() => setCollapsed(true)}>‹</button></header>
    <button type="button" className="new-chat-button" onClick={onCreate}>＋ Novo chat</button>
    <input aria-label="Buscar conversas" placeholder="Buscar conversas" value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="chat-list">
      {active.map((chat) => editingId === chat.id
        ? <form key={chat.id} onSubmit={(event) => { event.preventDefault(); onRename(chat.id, title); setEditingId(undefined) }}><input autoFocus aria-label="Novo título" value={title} onChange={(event) => setTitle(event.target.value)} /><button type="submit">Salvar</button></form>
        : <div className={`chat-list-row ${chat.id === selectedChatId ? 'selected' : ''}`} key={chat.id}>
          <button type="button" className="chat-select" onClick={() => onSelect(chat.id)}>{chat.title}</button>
          <button type="button" aria-label={`Renomear ${chat.title}`} onClick={() => { setTitle(chat.title); setEditingId(chat.id) }}>✎</button>
          <button type="button" aria-label={`Arquivar ${chat.title}`} onClick={() => onArchive(chat.id)}>×</button>
        </div>)}
      {!!archived.length && <details><summary>Arquivadas ({archived.length})</summary>{archived.map((chat) => <button type="button" className="archived-chat" key={chat.id} onClick={() => onSelect(chat.id)}>{chat.title}</button>)}</details>}
    </div>
  </aside>
}
