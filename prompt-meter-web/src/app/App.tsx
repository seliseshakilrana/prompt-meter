import { AppProviders } from "./providers/AppProviders";
import { AuthProvider } from "./providers/AuthProvider";
import { AppRouter } from "./router/routes";

export function App() {
  return (
    <AppProviders>
      <AuthProvider>
        <AppRouter />
      </AuthProvider>
    </AppProviders>
  );
}
