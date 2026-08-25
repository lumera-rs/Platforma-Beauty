import * as React from "react"
import { Input } from "./input"

export function DebouncedInput({
  value: initialValue,
  onChange,
  debounce = 300,
  ...props
}: {
  value: string | number
  onChange: (value: string | number) => void
  debounce?: number
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'>) {
  const [value, setValue] = React.useState(initialValue)
  const onChangeRef = React.useRef(onChange);
  const isMount = React.useRef(true);

  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  React.useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

  React.useEffect(() => {
    if (isMount.current) {
      isMount.current = false;
      return;
    }
    
    if (value === initialValue) return;

    const timeout = setTimeout(() => {
      onChangeRef.current(value)
    }, debounce)

    return () => clearTimeout(timeout)
  }, [value, debounce, initialValue])

  return (
    <Input {...props} value={value} onChange={e => setValue(e.target.value)} />
  )
}
