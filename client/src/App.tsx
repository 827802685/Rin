import { AppProviders } from "./app/providers";
import { AppRoutes } from "./app/routes";
import { useAppBootstrap } from "./app/use-app-bootstrap";
import { ThemeWidgets } from "./components/theme/theme-widgets";
import { ReadingProgress } from "./components/reading-progress";
import { ScrollEffects } from "./components/scroll-effects";

function App() {
  const { config, profile } = useAppBootstrap();

  return (
    <AppProviders config={config} profile={profile}>
      <ReadingProgress />
      <ScrollEffects />
      <AppRoutes />
      <ThemeWidgets />
    </AppProviders>
  )
}

export default App
