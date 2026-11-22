import { useCallback, useEffect, useState } from 'react'
import { Activity, Download, RefreshCw, Save, Search, ShieldCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../../services/api.js'
import './AdminSystemPage.css'
import './SystemSettings.css'

const defaultSettings = {
  general: { institutionName: '', logo: '', contactEmail: '', phone: '', address: '', timezone: 'Africa/Nairobi', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  academic: { academicYear: '', semester: '', gradingScale: [{ label: 'A', min: 80, max: 100 }, { label: 'B', min: 70, max: 79.99 }, { label: 'C', min: 60, max: 69.99 }, { label: 'D', min: 50, max: 59.99 }, { label: 'F', min: 0, max: 49.99 }], passingMarks: 50 },
  uploads: { maxFileSizeMB: 10, assignmentTypes: ['pdf', 'doc', 'docx', 'ppt', 'pptx'], learningMaterialTypes: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'webp'], profileImageTypes: ['jpg', 'jpeg', 'png', 'webp'] },
}
const materialOptions = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'webp']
const dateLabel = (value) => value ? new Date(value).toLocaleString() : '—'

function PageHeader({ title, description, icon: Icon = ShieldCheck, action }) {
  return <div className="page-heading"><div><span className="eyebrow"><Icon size={14} /> ADMINISTRATION</span><h1>{title}</h1><p>{description}</p></div>{action}</div>
}

function SystemSettings() {
  const [settings, setSettings] = useState(defaultSettings)
  const [semesterOptions, setSemesterOptions] = useState([])
  const [newSemester, setNewSemester] = useState('')
  const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true)
  useEffect(() => { Promise.all([api.get('/admin/settings'), api.get('/academic/options')]).then(([settingsResult, optionsResult]) => { setSettings(settingsResult.data.settings); setSemesterOptions(optionsResult.data.semesters || []) }).catch((error) => toast.error(apiErrorMessage(error))).finally(() => setLoading(false)) }, [])
  const set = (section, field, value) => setSettings((current) => ({ ...current, [section]: { ...current[section], [field]: value } }))
  const configuredSemesters = settings.academic.semesters?.length ? settings.academic.semesters : semesterOptions
  function addSemester() {
    const value = newSemester.trim()
    if (!value) return toast.error('Enter a semester name')
    if (configuredSemesters.some((item) => item.toLowerCase() === value.toLowerCase())) return toast.error('That semester already exists')
    set('academic', 'semesters', [...configuredSemesters, value])
    setNewSemester('')
  }
  function removeSemester(value) {
    const remaining = configuredSemesters.filter((item) => item !== value)
    if (!remaining.length) return toast.error('At least one semester must remain')
    set('academic', 'semesters', remaining)
    if (settings.academic.semester === value) set('academic', 'semester', '')
  }
  const setGrade = (index, field, value) => setSettings((current) => ({ ...current, academic: { ...current.academic, gradingScale: current.academic.gradingScale.map((grade, i) => i === index ? { ...grade, [field]: value } : grade) } }))
  async function save(event) {
    event.preventDefault()
    if (!window.confirm('Save these system-wide settings? Changes affect all users and upload validation.')) return
    setBusy(true)
    try { const { data } = await api.put('/admin/settings', settings); setSettings(data.settings); toast.success('System settings saved') }
    catch (error) { toast.error(apiErrorMessage(error)) }
    finally { setBusy(false) }
  }
  const field = (section, key, label, type = 'text') => <label className="system-field" key={`${section}-${key}`}><span>{label}</span>{section === 'academic' && key === 'semester' ? <select value={settings[section]?.[key] ?? ''} onChange={(event) => set(section, key, event.target.value)}><option value="">Select semester</option>{!configuredSemesters.includes(settings[section]?.[key]) && settings[section]?.[key] && <option value={settings[section][key]}>{settings[section][key]}</option>}{configuredSemesters.map((semester) => <option value={semester} key={semester}>{semester}</option>)}</select> : <input type={type} value={settings[section]?.[key] ?? ''} onChange={(event) => set(section, key, type === 'number' ? Number(event.target.value) : event.target.value)} />}</label>
  const toggle = (section, key, extension) => <label className="system-check" key={`${section}-${extension}`}><input type="checkbox" checked={settings[section]?.[key]?.includes(extension) || false} onChange={(event) => set(section, key, event.target.checked ? [...settings[section][key], extension] : settings[section][key].filter((item) => item !== extension))} /><span>{extension.toUpperCase()}</span></label>
  return <>{loading ? <div className="content-card system-loading">Loading system settings…</div> : <form className="system-form" onSubmit={save}>
    <section className="content-card system-section"><div className="panel-heading"><div><h2>General settings</h2><p>Institution identity and regional display preferences.</p></div></div><div className="system-fields">{field('general', 'institutionName', 'Institution name')}{field('general', 'logo', 'Logo URL or /uploads path')}{field('general', 'contactEmail', 'Contact email', 'email')}{field('general', 'phone', 'Phone number')}{field('general', 'address', 'Address')}{field('general', 'timezone', 'Timezone')}</div><div className="system-fields"><label className="system-field"><span>Date format</span><select value={settings.general.dateFormat} onChange={(e) => set('general', 'dateFormat', e.target.value)}><option>DD/MM/YYYY</option><option>YYYY-MM-DD</option><option>MM/DD/YYYY</option></select></label><label className="system-field"><span>Time format</span><select value={settings.general.timeFormat} onChange={(e) => set('general', 'timeFormat', e.target.value)}><option value="24h">24 hour</option><option value="12h">12 hour</option></select></label></div></section>
    <section className="content-card system-section"><div className="panel-heading"><div><h2>Academic settings</h2><p>Current academic year, semester information, and grading defaults.</p></div></div><div className="system-fields">{field('academic', 'academicYear', 'Academic year')}{field('academic', 'semester', 'Current semester')}{field('academic', 'passingMarks', 'Passing marks (%)', 'number')}</div><div className="semester-manager"><div><b>Semester options</b><p>Manage the semesters available when creating or importing courses.</p></div><form onSubmit={(event) => { event.preventDefault(); addSemester() }}><input value={newSemester} maxLength={80} onChange={(event) => setNewSemester(event.target.value)} placeholder="e.g. Semester-9" aria-label="New semester name" /><button className="button-secondary" type="submit">Add semester</button></form><div className="semester-option-list">{configuredSemesters.map((semester) => <div className="semester-option" key={semester}><span>{semester}</span><button type="button" className="button-quiet" onClick={() => removeSemester(semester)}>Remove</button></div>)}</div></div><div className="grading-scale-editor"><div className="grading-scale-heading"><b>Default grading scale</b><span>Ranges must cover 0–100 without overlap.</span></div>{settings.academic.gradingScale.map((grade, index) => <div className="grading-scale-row" key={`${index}-${grade.label}`}><label className="system-field"><span>Grade</span><input value={grade.label} maxLength={20} onChange={(event) => setGrade(index, 'label', event.target.value)} /></label><label className="system-field"><span>Minimum (%)</span><input type="number" min="0" max="100" step="0.01" value={grade.min} onChange={(event) => setGrade(index, 'min', event.target.value === '' ? '' : Number(event.target.value))} /></label><label className="system-field"><span>Maximum (%)</span><input type="number" min="0" max="100" step="0.01" value={grade.max} onChange={(event) => setGrade(index, 'max', event.target.value === '' ? '' : Number(event.target.value))} /></label><button className="button-quiet grading-remove" type="button" aria-label={`Remove grade ${grade.label}`} disabled={settings.academic.gradingScale.length <= 2} onClick={() => set('academic', 'gradingScale', settings.academic.gradingScale.filter((_, i) => i !== index))}>Remove</button></div>)}<button className="button-secondary grading-add" type="button" onClick={() => set('academic', 'gradingScale', [...settings.academic.gradingScale, { label: '', min: 0, max: 0 }])}>Add grade</button></div></section>
    <section className="content-card system-section"><div className="panel-heading"><div><h2>File upload settings</h2><p>Allowed file types and sizes are checked by the server before storing uploads.</p></div></div>{field('uploads', 'maxFileSizeMB', 'Maximum file size (MB)', 'number')}<div className="upload-type-groups"><div><b>Assignment submissions</b><div className="upload-type-list">{['pdf', 'doc', 'docx', 'ppt', 'pptx'].map((extension) => toggle('uploads', 'assignmentTypes', extension))}</div></div><div><b>Learning materials</b><div className="upload-type-list">{materialOptions.map((extension) => toggle('uploads', 'learningMaterialTypes', extension))}</div></div><div><b>Profile images</b><div className="upload-type-list">{['jpg', 'jpeg', 'png', 'webp'].map((extension) => toggle('uploads', 'profileImageTypes', extension))}</div></div></div></section>
    <div className="system-save-row"><span>Secrets such as JWT and database credentials are managed outside this screen.</span><button className="button-primary" disabled={busy}><Save size={15} />{busy ? 'Saving…' : 'Save settings'}</button></div>
  </form>}</>
}

function SemesterManagement() {
  const [settings, setSettings] = useState(null)
  const [newSemester, setNewSemester] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => { api.get('/admin/settings').then(({ data }) => setSettings(data.settings)).catch((error) => toast.error(apiErrorMessage(error))).finally(() => setLoading(false)) }, [])
  const semesters = settings?.academic?.semesters || []
  function addSemester() {
    const name = newSemester.trim()
    if (!name) return toast.error('Enter a semester name')
    if (semesters.some((semester) => semester.toLowerCase() === name.toLowerCase())) return toast.error('That semester already exists')
    if (semesters.length >= 30) return toast.error('You can configure up to 30 semesters')
    setSettings((current) => ({ ...current, academic: { ...current.academic, semesters: [...semesters, name] } }))
    setNewSemester('')
  }
  function removeSemester(name) {
    if (semesters.length <= 1) return toast.error('At least one semester must remain')
    setSettings((current) => ({ ...current, academic: { ...current.academic, semesters: semesters.filter((semester) => semester !== name), semester: current.academic.semester === name ? '' : current.academic.semester } }))
  }
  async function save(event) {
    event.preventDefault()
    setBusy(true)
    try { const { data } = await api.put('/admin/settings', settings); setSettings(data.settings); toast.success('Semester settings saved') }
    catch (error) { toast.error(apiErrorMessage(error)) }
    finally { setBusy(false) }
  }
  return <>{loading ? <div className="content-card system-loading">Loading semesters…</div> : settings && <form className="system-form" onSubmit={save}>
    <section className="content-card system-section"><div className="panel-heading"><div><h2>Semester list</h2><p>Add semester options and choose the one currently in use.</p></div></div>
      <label className="system-field"><span>Current semester</span><select value={settings.academic.semester || ''} onChange={(event) => setSettings((current) => ({ ...current, academic: { ...current.academic, semester: event.target.value } }))}><option value="">Select semester</option>{semesters.map((semester) => <option key={semester} value={semester}>{semester}</option>)}</select></label>
      <div className="semester-manage-list">{semesters.map((semester) => <div className="semester-manage-row" key={semester}><span>{semester}{settings.academic.semester === semester && <small>Current</small>}</span><button type="button" className="button-secondary" onClick={() => removeSemester(semester)}>Remove</button></div>)}</div>
      <div className="semester-add-row"><label className="system-field"><span>Add semester</span><input value={newSemester} maxLength={80} placeholder="e.g. Semester 9" onChange={(event) => setNewSemester(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addSemester() } }} /></label><button type="button" className="button-secondary" onClick={addSemester}>Add semester</button></div>
    </section><div className="system-save-row"><button className="button-primary" disabled={busy}><Save size={15} />{busy ? 'Saving…' : 'Save semesters'}</button></div>
  </form>}</>
}

function AuditLogs() {
  const [filters, setFilters] = useState({ user: '', action: '', resourceType: '', from: '', to: '' })
  const [page, setPage] = useState(1); const [data, setData] = useState({ logs: [], pagination: { pages: 1, total: 0 } }); const [selected, setSelected] = useState(null); const [busy, setBusy] = useState(false)
  const load = useCallback(async () => { setBusy(true); try { const { data: result } = await api.get('/admin/audit-logs', { params: { ...filters, page, limit: 25 } }); setData(result) } catch (error) { toast.error(apiErrorMessage(error)) } finally { setBusy(false) } }, [filters, page])
  useEffect(() => { load() }, [load])
  async function exportRows() { try { const response = await api.get('/admin/audit-logs/export', { params: filters, responseType: 'blob' }); const url = URL.createObjectURL(response.data); const link = document.createElement('a'); link.href = url; link.download = 'audit-logs.csv'; link.click(); URL.revokeObjectURL(url) } catch (error) { toast.error(apiErrorMessage(error)) } }
  return <><div className="page-heading page-heading-actions"><div /><button className="button-secondary" onClick={exportRows}><Download size={15} /> Export CSV</button></div>
    <section className="content-card audit-filter-card"><div className="audit-filters"><label><Search size={15} /><input placeholder="Search user name or email" value={filters.user} onChange={(e) => { setPage(1); setFilters({ ...filters, user: e.target.value }) }} /></label><input aria-label="Action filter" placeholder="Action" value={filters.action} onChange={(e) => { setPage(1); setFilters({ ...filters, action: e.target.value }) }} /><input aria-label="Resource type filter" placeholder="Resource type" value={filters.resourceType} onChange={(e) => { setPage(1); setFilters({ ...filters, resourceType: e.target.value }) }} /><input aria-label="From date" type="date" value={filters.from} onChange={(e) => { setPage(1); setFilters({ ...filters, from: e.target.value }) }} /><input aria-label="To date" type="date" value={filters.to} onChange={(e) => { setPage(1); setFilters({ ...filters, to: e.target.value }) }} /><button className="icon-button" onClick={load} aria-label="Refresh audit logs"><RefreshCw size={16} /></button></div></section>
    <section className="content-card audit-table-card"><div className="audit-table-wrap"><table className="data-table"><thead><tr><th>Activity</th><th>User</th><th>Resource</th><th>IP address</th><th>Time</th></tr></thead><tbody>{data.logs.map((log) => <tr key={log._id} onClick={() => setSelected(log)}><td><b>{log.action}</b><small>{log.resourceType}{log.resourceId ? ` · ${log.resourceId}` : ''}</small></td><td>{log.actorId?.fullName || 'System'}<small>{log.actorId?.email || ''}</small></td><td>{log.resourceType}</td><td>{log.ipAddress || '—'}</td><td>{dateLabel(log.createdAt)}</td></tr>)}{!busy && !data.logs.length && <tr><td colSpan="5">No audit records match these filters.</td></tr>}</tbody></table></div><div className="audit-pagination"><span>{data.pagination.total} records</span><div><button className="button-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {Math.max(1, data.pagination.pages)}</span><button className="button-secondary" disabled={page >= data.pagination.pages} onClick={() => setPage(page + 1)}>Next</button></div></div></section>
    {selected && <div className="system-modal-backdrop" onClick={() => setSelected(null)}><section className="content-card audit-detail" onClick={(event) => event.stopPropagation()}><div className="panel-heading"><div><h2>Activity details</h2><p>{dateLabel(selected.createdAt)}</p></div><button className="button-quiet" onClick={() => setSelected(null)}>Close</button></div><dl><dt>Action</dt><dd>{selected.action}</dd><dt>Actor</dt><dd>{selected.actorId?.fullName || 'System'} {selected.actorId?.email ? `(${selected.actorId.email})` : ''}</dd><dt>Resource</dt><dd>{selected.resourceType} {selected.resourceId}</dd><dt>IP address</dt><dd>{selected.ipAddress || '—'}</dd><dt>User agent</dt><dd>{selected.userAgent || '—'}</dd><dt>Metadata</dt><dd><pre>{JSON.stringify(selected.metadata || {}, null, 2)}</pre></dd></dl></section></div>}
  </>
}

function SystemHealth() {
  const [health, setHealth] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const refresh = useCallback(async () => { setBusy(true); setError(''); try { const { data } = await api.get('/admin/system-health'); setHealth(data.health) } catch (e) { setError(apiErrorMessage(e)) } finally { setBusy(false) } }, [])
  useEffect(() => { refresh() }, [refresh])
  const bytes = (value) => value == null ? 'Unavailable' : `${(value / (1024 ** 3)).toFixed(1)} GB`
  return <><PageHeader title="System health" description="Current API, database, and upload storage status." icon={Activity} action={<button className="button-secondary" onClick={refresh} disabled={busy}><RefreshCw size={15} /> Refresh</button>} />{error && <div className="system-error">{error}</div>}<EmailProviderPanel />{health && <><div className="health-card-grid">{[['API', health.api], ['Database', health.database], ['Upload storage', health.storage.status]].map(([label, status]) => <article className="content-card health-card" key={label}><span>{label}</span><b className={status === 'ok' || status === 'connected' || status === 'available' ? 'health-ok' : 'health-down'}><i />{status}</b></article>)}</div><section className="content-card system-section"><div className="panel-heading"><div><h2>Runtime</h2><p>Safe operational details; credentials and environment secrets are not displayed.</p></div></div><dl className="health-details"><dt>Environment</dt><dd>{health.environment}</dd><dt>Application version</dt><dd>{health.version}</dd><dt>Storage capacity</dt><dd>{bytes(health.storage.totalBytes)}</dd><dt>Storage free</dt><dd>{bytes(health.storage.freeBytes)}</dd><dt>Last checked</dt><dd>{dateLabel(health.checkedAt)}</dd></dl></section></>}</>
}

function EmailProviderPanel() {
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [result, setResult] = useState(null)
  const load = useCallback(async () => { setError(''); try { const { data: body } = await api.get('/admin/email/status'); setData(body) } catch (e) { setError(apiErrorMessage(e)) } }, [])
  useEffect(() => { load() }, [load])
  async function testAndResume() {
    if (!window.confirm('Send one test email to the test recipient and, if it is accepted, resume paused email delivery?')) return
    setBusy(true); setResult(null)
    try { const { data: body } = await api.post('/admin/email/test-and-resume'); setResult(body); body.success ? toast.success(body.message) : toast.error(body.message); await load() }
    catch (e) { toast.error(apiErrorMessage(e)) }
    finally { setBusy(false) }
  }
  const provider = data?.provider
  const blocked = provider?.status === 'temporarily_blocked'
  const when = (value) => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'
  return <section className="content-card system-section email-provider-panel"><div className="panel-heading"><div><h2>Email delivery</h2><p>Provider status and the notification email queue. Credentials are never displayed.</p></div><button className="button-secondary" onClick={load} disabled={busy}><RefreshCw size={15} /> Refresh</button></div>
    {error && <div className="system-error">{error}</div>}
    {data && <>
      <div className="health-card-grid"><article className="content-card health-card"><span>Provider ({provider.name})</span><b className={blocked ? 'health-down' : 'health-ok'}><i />{blocked ? 'temporarily blocked' : 'ok'}</b></article><article className="content-card health-card"><span>Waiting emails</span><b>{data.queue.pending}</b></article><article className="content-card health-card"><span>Sent today / this month</span><b>{data.quota.sentToday} / {data.quota.sentThisMonth}</b></article><article className="content-card health-card"><span>Failed</span><b>{data.queue.failed}</b></article></div>
      {blocked && <div className="system-error email-provider-blocked"><b>Sending is paused.</b> The provider refused to send for this account on {when(provider.since)} (HTTP {provider.httpStatus || '—'}, {provider.providerErrorCode || provider.lastErrorCode}). Waiting emails are kept and will be sent once delivery is resumed. Share this reference with the provider's support: <code>{provider.providerErrorIdentifier || '—'}</code></div>}
      <dl className="email-provider-details"><div><dt>Sender (EMAIL_FROM)</dt><dd>{provider.senderEmail || '—'}</dd></div><div><dt>Test recipient</dt><dd>{provider.testRecipient || 'Your admin email'}</dd></div><div><dt>Last checked</dt><dd>{when(provider.lastCheckedAt)}</dd></div><div><dt>Last resumed</dt><dd>{when(provider.resumedAt)}</dd></div><div><dt>Remaining notification quota</dt><dd>{data.quota.available}</dd></div></dl>
      <div className="email-provider-actions"><button className="button-primary" onClick={testAndResume} disabled={busy}>{busy ? 'Testing…' : blocked ? 'Test connection & resume sending' : 'Send test email'}</button><small>Sends one real email to the test recipient (counts toward the daily quota). Delivery resumes only if the provider accepts it.</small></div>
      {result && !result.success && result.test && <p className="system-error">Test result: {result.test.errorCode}{result.test.httpStatus ? ` (HTTP ${result.test.httpStatus})` : ''}{result.test.providerErrorCode ? ` · ${result.test.providerErrorCode}` : ''}{result.test.providerErrorIdentifier ? ` · ref ${result.test.providerErrorIdentifier}` : ''}</p>}
    </>}
  </section>
}

export default function AdminSystemPage({ section }) {
  if (section === 'semesters') return <SemesterManagement />
  if (section === 'audit-logs') return <AuditLogs />
  if (section === 'system-health') return <SystemHealth />
  return <SystemSettings />
}
