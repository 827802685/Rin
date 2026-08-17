import { AppProviders } from "./app/providers";
import { AppRoutes } from "./app/routes";
import { useAppBootstrap } from "./app/use-app-bootstrap";
import { ThemeWidgets } from "./components/theme/theme-widgets";

function App() {
  const { config, profile } = useAppBootstrap();

  return (
    <AppProviders config={config} profile={profile}>
      <AppRoutes />
      <ThemeWidgets />
    </AppProviders>
  )
}

export default App
