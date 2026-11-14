import { SessionProvider } from './session'
import { Shell } from './ui/Shell'

export function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  )
}
