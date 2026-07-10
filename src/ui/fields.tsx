import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'

// DB(useLiveQuery)を裏に持つ入力欄は、1文字ごとに保存→再描画すると
// 日本語IMEの変換が中断される。入力中はローカル状態で保持し、
// blur / Enter で確定保存する。

type BaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>

interface TextProps extends BaseProps {
  value: string
  onCommit: (v: string) => void
}

export function TextField({ value, onCommit, onFocus, onBlur, onKeyDown, ...rest }: TextProps) {
  const [local, setLocal] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setLocal(value)
  }, [value])
  return (
    <input
      {...rest}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onFocus={(e) => { focused.current = true; onFocus?.(e) }}
      onBlur={(e) => {
        focused.current = false
        if (local !== value) onCommit(local)
        onBlur?.(e)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur()
        onKeyDown?.(e)
      }}
    />
  )
}

interface NumberProps extends BaseProps {
  value: number
  onCommit: (v: number) => void
}

export function NumberField({ value, onCommit, onFocus, onBlur, onKeyDown, ...rest }: NumberProps) {
  const [local, setLocal] = useState(String(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setLocal(String(value))
  }, [value])
  return (
    <input
      type="number"
      {...rest}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onFocus={(e) => { focused.current = true; onFocus?.(e) }}
      onBlur={(e) => {
        focused.current = false
        const n = Number(local)
        if (local !== '' && !Number.isNaN(n) && n !== value) onCommit(n)
        else setLocal(String(value))
        onBlur?.(e)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        onKeyDown?.(e)
      }}
    />
  )
}
