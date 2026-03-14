import { RouterProvider } from "react-router";
import { Toaster } from "sonner";
import { router } from "./routes";
import { AppProvider } from "../lib/store";

function App() {
  return (
    <AppProvider>
      <RouterProvider router={router} />
      <Toaster position="bottom-right" theme="dark" richColors />
    </AppProvider>
  );
}

export default App;
