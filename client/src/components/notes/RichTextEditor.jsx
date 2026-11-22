import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
// TipTap v3: StarterKit already includes Link and Underline; tables and placeholder are named exports.
import StarterKit from '@tiptap/starter-kit'
import TextAlign from '@tiptap/extension-text-align'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import Mathematics, { migrateMathStrings } from '@tiptap/extension-mathematics'
import 'katex/dist/katex.min.css'
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Code, Columns3, Italic, Link2, List, ListOrdered,
  Minus, Redo2, Rows3, Sigma, SquareCode, Strikethrough, Table as TableIcon, TextQuote, Trash2, Underline as UnderlineIcon, Undo2, Unlink,
} from 'lucide-react'

const safeUrl = (value) => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : ''
  } catch { return '' }
}

function ToolButton({ icon: Icon, label, active, disabled, onClick }) {
  return <button type="button" className={`note-tool ${active ? 'is-active' : ''}`} title={label} aria-label={label} aria-pressed={active ? 'true' : undefined} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={onClick}><Icon size={15} /></button>
}

function Toolbar({ editor }) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkValue, setLinkValue] = useState('')
  const [tableOpen, setTableOpen] = useState(false)
  const [, forceRender] = useState(0)
  useEffect(() => {
    if (!editor) return undefined
    const update = () => forceRender((value) => value + 1)
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    return () => { editor.off('selectionUpdate', update); editor.off('transaction', update) }
  }, [editor])
  if (!editor) return null
  const chain = () => editor.chain().focus()
  const blockValue = editor.isActive('heading', { level: 1 }) ? 'h1' : editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : editor.isActive('heading', { level: 4 }) ? 'h4' : 'p'
  const setBlock = (value) => {
    if (value === 'p') chain().setParagraph().run()
    else chain().setHeading({ level: Number(value.slice(1)) }).run()
  }
  const openLink = () => { setLinkValue(editor.getAttributes('link').href || ''); setLinkOpen(true); setTableOpen(false) }
  const applyLink = (event) => {
    event.preventDefault()
    const href = safeUrl(linkValue)
    if (!linkValue.trim()) chain().extendMarkRange('link').unsetLink().run()
    else if (href) chain().extendMarkRange('link').setLink({ href }).run()
    else return
    setLinkOpen(false)
  }
  const inTable = editor.isActive('table')
  return <div className="note-toolbar" role="toolbar" aria-label="Formatting">
    <div className="note-toolbar-row">
      <select className="note-block-select" aria-label="Text style" value={blockValue} onChange={(event) => setBlock(event.target.value)}>
        <option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option><option value="h4">Heading 4</option>
      </select>
      <span className="note-tool-group">
        <ToolButton icon={Bold} label="Bold (Ctrl+B)" active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()} />
        <ToolButton icon={Italic} label="Italic (Ctrl+I)" active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()} />
        <ToolButton icon={UnderlineIcon} label="Underline (Ctrl+U)" active={editor.isActive('underline')} onClick={() => chain().toggleUnderline().run()} />
        <ToolButton icon={Strikethrough} label="Strikethrough" active={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()} />
        <ToolButton icon={Code} label="Inline code" active={editor.isActive('code')} onClick={() => chain().toggleCode().run()} />
      </span>
      <span className="note-tool-group">
        <ToolButton icon={List} label="Bulleted list" active={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()} />
        <ToolButton icon={ListOrdered} label="Numbered list" active={editor.isActive('orderedList')} onClick={() => chain().toggleOrderedList().run()} />
        <ToolButton icon={TextQuote} label="Quote" active={editor.isActive('blockquote')} onClick={() => chain().toggleBlockquote().run()} />
        <ToolButton icon={SquareCode} label="Code block" active={editor.isActive('codeBlock')} onClick={() => chain().toggleCodeBlock().run()} />
      </span>
      <span className="note-tool-group">
        <ToolButton icon={AlignLeft} label="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => chain().setTextAlign('left').run()} />
        <ToolButton icon={AlignCenter} label="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => chain().setTextAlign('center').run()} />
        <ToolButton icon={AlignRight} label="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => chain().setTextAlign('right').run()} />
        <ToolButton icon={AlignJustify} label="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => chain().setTextAlign('justify').run()} />
      </span>
      <span className="note-tool-group">
        <ToolButton icon={Link2} label="Add link" active={editor.isActive('link') || linkOpen} onClick={openLink} />
        {editor.isActive('link') && <ToolButton icon={Unlink} label="Remove link" onClick={() => chain().extendMarkRange('link').unsetLink().run()} />}
        <ToolButton icon={TableIcon} label="Table" active={inTable || tableOpen} onClick={() => { setTableOpen((open) => !open); setLinkOpen(false) }} />
        <ToolButton icon={Sigma} label="Insert formula (LaTeX). Tip: type $x^2$ to add one inline" onClick={() => { const latex = window.prompt('Formula (LaTeX), for example E = mc^2', 'x^2'); if (latex?.trim()) chain().insertInlineMath({ latex: latex.trim() }).run() }} />
        <ToolButton icon={Minus} label="Divider" onClick={() => chain().setHorizontalRule().run()} />
      </span>
      <span className="note-tool-group">
        <ToolButton icon={Undo2} label="Undo (Ctrl+Z)" disabled={!editor.can().undo()} onClick={() => chain().undo().run()} />
        <ToolButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" disabled={!editor.can().redo()} onClick={() => chain().redo().run()} />
      </span>
    </div>
    {linkOpen && <form className="note-toolbar-row note-subbar" onSubmit={applyLink}>
      <input autoFocus type="text" inputMode="url" placeholder="Paste or type a link (https://…)" value={linkValue} onChange={(event) => setLinkValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setLinkOpen(false) }} aria-label="Link address" />
      <button type="submit" className="button-primary">Apply</button>
      <button type="button" className="button-quiet" onClick={() => setLinkOpen(false)}>Cancel</button>
      {linkValue.trim() && !safeUrl(linkValue) && <small className="note-subbar-error">Use an http, https or mailto link.</small>}
    </form>}
    {tableOpen && <div className="note-toolbar-row note-subbar">
      {!inTable ? <button type="button" className="button-secondary" onClick={() => { chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); setTableOpen(false) }}><TableIcon size={14} /> Insert 3 × 3 table</button> : <>
        <button type="button" className="button-quiet" onClick={() => chain().addRowAfter().run()}><Rows3 size={14} /> Add row</button>
        <button type="button" className="button-quiet" onClick={() => chain().addColumnAfter().run()}><Columns3 size={14} /> Add column</button>
        <button type="button" className="button-quiet" onClick={() => chain().deleteRow().run()}>Delete row</button>
        <button type="button" className="button-quiet" onClick={() => chain().deleteColumn().run()}>Delete column</button>
        <button type="button" className="button-quiet" onClick={() => chain().toggleHeaderRow().run()}>Header row</button>
        <button type="button" className="button-quiet danger-text" onClick={() => { chain().deleteTable().run(); setTableOpen(false) }}><Trash2 size={14} /> Delete table</button>
      </>}
    </div>}
  </div>
}

/**
 * Long-form rich-text editor. `content` is only read when the editor mounts; remount it with a
 * new `key` to load different content. `onChange` receives a getter for the JSON document.
 */
export default function RichTextEditor({ content, onChange, placeholder = 'Start writing your notes…', autoFocus = false }) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const editorRef = useRef(null)
  // Click a formula to edit it; an empty value removes it.
  const editFormula = (type) => (node, pos) => {
    const current = editorRef.current
    if (!current) return
    const latex = window.prompt('Edit formula (LaTeX). Leave empty to remove it.', node.attrs.latex)
    if (latex === null) return
    const chain = current.chain().setNodeSelection(pos)
    if (!latex.trim()) chain.deleteSelection().run()
    else if (type === 'inline') chain.updateInlineMath({ latex: latex.trim() }).run()
    else chain.updateBlockMath({ latex: latex.trim() }).run()
  }
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4] },
        link: { openOnClick: false, autolink: true, linkOnPaste: true, protocols: ['mailto'], HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' }, isAllowedUri: (href) => Boolean(safeUrl(href)) },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder }),
      Mathematics.configure({
        katexOptions: { throwOnError: false },
        inlineOptions: { onClick: editFormula('inline') },
        blockOptions: { onClick: editFormula('block') },
      }),
    ],
    content,
    autofocus: autoFocus ? 'end' : false,
    // Notes written before the v3 upgrade stored formulas as $…$ text: convert them to math nodes.
    onCreate: ({ editor: current }) => { editorRef.current = current; migrateMathStrings(current) },
    editorProps: { attributes: { class: 'note-prose', spellcheck: 'true', 'aria-label': 'Note content', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor: current }) => onChangeRef.current?.(() => current.getJSON()),
  })
  return <div className="note-editor">
    <Toolbar editor={editor} />
    <EditorContent editor={editor} className="note-editor-content" />
  </div>
}
