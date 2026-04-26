import { useEffect, useRef, useState } from "react";

export const useDebounceSearch = (delay = 400) => {
  const [inputValue, setInputValue] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const setDebouncedSearch = (val) => {
    setInputValue(val);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSearchTerm(val), delay);
  };

  return { inputValue, searchTerm, setDebouncedSearch };
};
