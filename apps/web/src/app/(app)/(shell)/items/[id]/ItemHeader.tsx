"use client";

import { useState } from "react";
import type { Item } from "@harbor/shared";
import { ItemIdentity } from "./ItemIdentity";
import { ItemMenu } from "./ItemMenu";

/**
 * The name, and the one control that changes it.
 *
 * It exists because the menu and the name have to agree about one thing — whether the name is
 * being edited — and a server page cannot hold that between them.
 */
export function ItemHeader({ item }: { item: Item }) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <div className="min-w-0 flex-1">
        <ItemIdentity item={item} editing={editing} onEditingChange={setEditing} />
      </div>
      {/* Hidden while editing: the form has its own Save and Cancel, and a menu offering "Edit" again would be noise. */}
      {!editing && <ItemMenu item={item} onEdit={() => setEditing(true)} />}
    </div>
  );
}
