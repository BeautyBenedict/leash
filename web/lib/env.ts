// Vercel/clipboard pastes often add spaces, quotes or line breaks. Strip them so a pasted secret still works.
export const clean = (v: string | undefined): string => (v ?? "").replace(/[\s"'​-‍﻿]/g, "");
