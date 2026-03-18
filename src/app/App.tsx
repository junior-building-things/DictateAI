import { RouterProvider } from "react-router";
import { Toaster } from "sonner";
import { router } from "./routes";
import { I18nProvider } from "../lib/i18n";
import { AppProvider } from "../lib/store";

function App() {
  return (
    <I18nProvider>
      <AppProvider>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" theme="dark" richColors />
      </AppProvider>
    </I18nProvider>
  );
}

export default App;
