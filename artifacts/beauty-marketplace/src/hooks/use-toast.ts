import * as React from "react"
import { toast as sonnerToast } from "sonner"

export function useToast() {
  return {
    toast: sonnerToast,
  }
}
