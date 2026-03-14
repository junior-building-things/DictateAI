import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Hotkey } from "./pages/Hotkey";
import { Models } from "./pages/Models";
import { RewriteRules } from "./pages/RewriteRules";
import { History } from "./pages/History";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Home },
      { path: "hotkey", Component: Hotkey },
      { path: "models", Component: Models },
      { path: "rewrite-rules", Component: RewriteRules },
      { path: "history", Component: History },
    ],
  },
]);
