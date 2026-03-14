import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { History } from "./pages/History";
import { Home } from "./pages/Home";
import { Models } from "./pages/Models";
import { RewriteRules } from "./pages/RewriteRules";
import { Vocabulary } from "./pages/Vocabulary";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Home },
      { path: "models", Component: Models },
      { path: "rewrite-rules", Component: RewriteRules },
      { path: "vocabulary", Component: Vocabulary },
      { path: "history", Component: History },
    ],
  },
]);
