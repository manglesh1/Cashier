import React, { useRef, useEffect } from 'react';

export function Icon({ name, size = 20, stroke = 1.75, ...rest }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current && window.lucide) {
      ref.current.innerHTML = "";
      const i = document.createElement("i");
      i.setAttribute("data-lucide", name);
      ref.current.appendChild(i);
      window.lucide.createIcons({ attrs: { width: size, height: size, "stroke-width": stroke } });
    }
  }, [name, size, stroke]);

  return (
    <span
      ref={ref}
      style={{ display: "inline-flex", width: size, height: size, ...rest.style }}
      {...rest}
    />
  );
}
