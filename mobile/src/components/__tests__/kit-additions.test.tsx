import { render, screen } from "@testing-library/react-native";

import { Ring } from "@/components/home/parts";
import { Row } from "@/components/ui";

describe("kit additions", () => {
  it("draws a search match in bold inside the row title (board B4)", async () => {
    await render(<Row title="Maria Alvarez" highlight="alva" />);
    const bold = screen.getByText("Alva");
    expect(bold).toHaveStyle({ fontFamily: "Inter_700Bold" });
    expect(screen.getByText(/Maria/)).toBeTruthy();
  });

  it("leaves the title plain when nothing matches", async () => {
    await render(<Row title="Robert Chen" highlight="zzz" />);
    expect(screen.getByText("Robert Chen")).toBeTruthy();
  });

  it("labels the setter's ring with the week's count (board B3)", async () => {
    await render(<Ring pct={72} size={84} label="18/25" gold />);
    expect(screen.getByText("18/25")).toBeTruthy();
    expect(screen.getByLabelText("18/25")).toBeTruthy();
  });
});
