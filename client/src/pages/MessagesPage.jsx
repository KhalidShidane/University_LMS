import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, MessageCircle, MoreHorizontal, Plus, Send, UserRound, X } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../services/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import ProfileAvatar from '../components/common/ProfileAvatar.jsx'
import { EmptyState, ErrorState, PageLoading } from '../components/ui/States.jsx'
import './MessagesPage.css'

const timestamp = (value) => new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
const dayLabel = (value) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))

export default function MessagesPage() {
  const { conversationId } = useParams()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [conversations, setConversations] = useState([])
  const [messages, setMessages] = useState([])
  const [messagesPagination, setMessagesPagination] = useState(null)
  const [contacts, setContacts] = useState([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [sending, setSending] = useState(false)
  const [showContacts, setShowContacts] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef(null)
  const shouldScrollRef = useRef(true)
  const activeConversationRef = useRef(conversationId)

  const loadConversations = useCallback(async () => {
    try { const { data } = await api.get('/conversations'); setConversations(data.conversations) } catch (e) { setError(apiErrorMessage(e)) } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadConversations(); const interval = setInterval(loadConversations, 15_000); return () => clearInterval(interval) }, [loadConversations])
  useEffect(() => { if (searchParams.get('help') === '1') openContacts() }, [])

  const loadMessages = useCallback(async (quiet = false) => {
    if (!conversationId) { setMessages([]); setMessagesPagination(null); return }
    const conversationChanged = activeConversationRef.current !== conversationId
    activeConversationRef.current = conversationId
    if (conversationChanged) { setMessages([]); setMessagesPagination(null) }
    if (!quiet) setLoadingMessages(true)
    try {
      const { data } = await api.get(`/conversations/${conversationId}/messages`, { params: { limit: 100 } })
      setMessages((current) => {
        if (conversationChanged) return data.messages
        const latestIds = new Set(data.messages.map((message) => message._id))
        const older = messagesPagination?.page > 1 ? current.filter((message) => !latestIds.has(message._id)) : []
        return [...older, ...data.messages]
      })
      setMessagesPagination((current) => ({
        ...data.pagination,
        page: conversationChanged ? 1 : Math.min(Math.max(current?.page || 1, data.pagination.page), data.pagination.pages || 1),
      }))
      await api.patch(`/conversations/${conversationId}/read`)
      setConversations((items) => items.map((item) => item._id === conversationId ? { ...item, unreadCount: 0 } : item))
    } catch (e) { if (!quiet) toast.error(apiErrorMessage(e)) } finally { setLoadingMessages(false) }
  }, [conversationId, messagesPagination?.page])
  useEffect(() => { loadMessages(); const interval = conversationId ? setInterval(() => loadMessages(true), 6000) : undefined; return () => { if (interval) clearInterval(interval) } }, [loadMessages])
  useEffect(() => { if (shouldScrollRef.current) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); shouldScrollRef.current = true }, [messages])

  async function loadOlderMessages() {
    if (!conversationId || loadingOlder || !messagesPagination || messagesPagination.page >= messagesPagination.pages) return
    setLoadingOlder(true)
    shouldScrollRef.current = false
    try {
      const page = messagesPagination.page + 1
      const { data } = await api.get(`/conversations/${conversationId}/messages`, { params: { page, limit: 100 } })
      setMessages((current) => [...data.messages.filter((message) => !current.some((item) => item._id === message._id)), ...current])
      setMessagesPagination(data.pagination)
    } catch (e) { toast.error(apiErrorMessage(e)) } finally { setLoadingOlder(false); shouldScrollRef.current = true }
  }

  async function startConversation(contact) {
    try {
      const { data } = await api.post('/conversations', { targetUserId: contact._id, classId: contact.classId })
      setShowContacts(false); await loadConversations(); navigate(`/app/messages/${data.conversation._id}`)
    } catch (e) { toast.error(apiErrorMessage(e)) }
  }

  async function openContacts() {
    try { const support = user.role === 'teacher' && searchParams.get('help') === '1'; const { data } = await api.get('/conversations/contacts', { params: support ? { support: '1' } : undefined }); setContacts(data.contacts); setShowContacts(true) } catch (e) { toast.error(apiErrorMessage(e)) }
  }

  async function sendMessage(event) {
    event.preventDefault()
    if (!draft.trim() || !conversationId || sending) return
    setSending(true)
    try {
      shouldScrollRef.current = true
      const { data } = await api.post(`/conversations/${conversationId}/messages`, { messageText: draft })
      setMessages((items) => [...items, data.message]); setDraft(''); await loadConversations()
    } catch (e) { toast.error(apiErrorMessage(e)) } finally { setSending(false) }
  }

  if (loading && !conversations.length && error) return <ErrorState message={error} onRetry={loadConversations} />
  if (loading) return <PageLoading />
  const current = conversations.find((item) => item._id === conversationId)

  return <div className={`messages-page ${conversationId ? 'messages-has-active' : ''}`}><div className="section-title-row messages-title"><div><div className="section-kicker">PRIVATE COMMUNICATION</div><h1>Messages</h1><p>Talk with teachers and students from your assigned classes.</p></div><button className="button-primary" onClick={openContacts}><Plus size={16} /> New message</button></div>
    <section className="panel messages-workspace"><aside className="conversation-sidebar"><div className="conversation-sidebar-head"><b>Conversations</b><button className="icon-button" onClick={openContacts} aria-label="New message"><Plus size={17} /></button></div>{conversations.length ? <div className="conversation-list">{conversations.map((conversation) => <button className={`conversation-list-item ${conversation._id === conversationId ? 'conversation-selected' : ''}`} key={conversation._id} onClick={() => navigate(`/app/messages/${conversation._id}`)}><ProfileAvatar user={conversation.otherParticipant} size="normal" /><span className="conversation-list-copy"><b>{conversation.otherParticipant?.fullName || 'Class member'}</b><small>{conversation.lastMessage || 'Start a conversation'}</small></span><span className="conversation-list-meta">{conversation.lastMessageAt && <time>{timestamp(conversation.lastMessageAt)}</time>}{conversation.unreadCount > 0 && <i>{conversation.unreadCount}</i>}</span></button>)}</div> : <div className="conversation-empty"><MessageCircle size={22} /><p>No conversations yet.</p><button className="button-quiet" onClick={openContacts}>Message a class member</button></div>}</aside>
      <div className="conversation-panel">{current && messagesPagination?.page < messagesPagination?.pages && <button className="button-quiet conversation-load-older" onClick={loadOlderMessages} disabled={loadingOlder}>{loadingOlder ? 'Loading earlier messages�' : 'Load earlier messages'}</button>}{current ? <><header className="conversation-header"><button className="icon-button conversation-back" onClick={() => navigate('/app/messages')} aria-label="Back to conversations"><ArrowLeft size={17} /></button><ProfileAvatar user={current.otherParticipant} size="normal" /><span><b>{current.otherParticipant?.fullName || 'Class member'}</b><small>{current.otherParticipant?.role === 'admin' ? 'Administrator' : current.otherParticipant?.role === 'teacher' ? 'Teacher' : 'Student'} · Class conversation</small></span><button className="icon-button" aria-label="Conversation options" title="Conversation details"><MoreHorizontal size={18} /></button></header>{loadingMessages ? <div className="conversation-message-loading">Loading messages…</div> : messages.length ? <div className="conversation-messages">{messages.map((message, index) => { const own = String(message.senderId?._id || message.senderId) === String(user?.id || user?._id); const previous = messages[index - 1]; const showDate = !previous || dayLabel(previous.createdAt) !== dayLabel(message.createdAt); return <div key={message._id}>{showDate && <div className="conversation-date-separator"><span>{dayLabel(message.createdAt)}</span></div>}<article className={`message-bubble-row ${own ? 'message-bubble-own' : ''}`}><div className="message-bubble"><p>{message.messageText}</p><time>{timestamp(message.createdAt)}</time></div></article></div>})}<div ref={endRef} /></div> : <div className="conversation-no-messages"><MessageCircle size={25} /><b>Start the conversation</b><span>Send a message to {current.otherParticipant?.fullName || 'your classmate'}.</span></div>}<form className="message-composer" onSubmit={sendMessage}><textarea rows="1" maxLength="5000" placeholder="Write a message…" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e) } }} aria-label="Write a message" /><button className="button-primary" type="submit" disabled={!draft.trim() || sending} aria-label="Send message">{sending ? 'Sending…' : <><Send size={16} /> Send</>}</button></form></> : <div className="conversation-placeholder"><span><UserRound size={25} /></span><b>Your messages</b><p>Select a conversation or start a new message with a teacher or student in your class.</p><button className="button-secondary" onClick={openContacts}><Plus size={15} /> New conversation</button></div>}</div></section>
    {showContacts && <div className="modal-backdrop" role="presentation"><section className="panel message-contact-modal" role="dialog" aria-modal="true" aria-labelledby="message-contact-title"><div className="panel-heading"><div><span className="section-kicker">MESSAGES AND SUPPORT</span><h2 id="message-contact-title">New message</h2><p>{user.role === 'student' ? 'Teachers assigned to your class' : user.role === 'teacher' && searchParams.get('help') === '1' ? 'Send a message to a university administrator' : user.role === 'admin' ? 'Teachers who need support' : 'Students in classes assigned to you'}</p></div><button className="icon-button" onClick={() => setShowContacts(false)} aria-label="Close"><X size={18} /></button></div><div className="message-contact-list">{contacts.length ? contacts.map((contact) => <button key={contact._id} className="message-contact-item" onClick={() => startConversation(contact)}><ProfileAvatar user={contact} size="normal" /><span><b>{contact.fullName}</b><small>{contact.role === 'admin' ? 'Administrator' : contact.role === 'teacher' ? 'Teacher' : `${contact.studentId || 'Student'} · ${contact.classId?.classCode || ''}`}</small></span><ArrowRight size={16} /></button>) : <EmptyState title="No class contacts available" description="Only teachers and students assigned to your classes can message each other." icon={UserRound} />}</div></section></div>}
  </div>
}
