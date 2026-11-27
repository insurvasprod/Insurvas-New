import { Stack, useLocalSearchParams } from "expo-router";

import { AddExpense } from "@/components/money/add-expense";

/**
 * Boards G5 + G6 · Expenses › Add (the web's /app/expenses/new): the camera opens first, then the new expense as a
 * sheet over Money with the photo on it. A photo already taken (a link that carries one) skips the camera.
 */
export default function ExpenseRoute() {
  const { uri, name, type } = useLocalSearchParams<{ uri?: string; name?: string; type?: string }>();
  // Only a photo file the camera just wrote on this phone is taken from the link.
  const photo = typeof uri === "string" && (uri.startsWith("file:") || uri.startsWith("content:")) ? { uri, name: typeof name === "string" && name ? name : "receipt.jpg", type: type === "image/png" ? "image/png" : "image/jpeg" } : null;
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <AddExpense initialPhoto={photo} />
    </>
  );
}
