import { useNavigate } from "react-router-dom";

import { Button, Card, EmptyState } from "@/components/ui";

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <Card className="mt-space-xl">
      <EmptyState
        icon="explore_off"
        title="This page doesn't exist"
        body="The link may be old, or the item was deleted."
        action={<Button onClick={() => navigate("/")}>Back to dashboard</Button>}
      />
    </Card>
  );
}
