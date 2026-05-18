import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { History } from "./pages/History";
import { Settings } from "./pages/Settings";
import { Vocabulary } from "./pages/Vocabulary";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: Dashboard },
      { path: "history", Component: History },
      { path: "vocabulary", Component: Vocabulary },
      { path: "settings", Component: Settings },
    ],
  },
]);
