import { useToast } from "@/hooks/use-toast"
import { Toaster as Sonner } from "sonner"

export function Toaster() {
  return (
    <Sonner className="toaster group" position="bottom-right" />
  )
}
