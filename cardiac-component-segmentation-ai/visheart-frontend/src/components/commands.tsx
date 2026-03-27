"use client";

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export function Commands() {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showCommandDropdown, setShowCommandDropdown] = useState(false);

  // Navigation function
  const navigateToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
      setShowCommandDropdown(false);
    }
  };

  // Keyboard shortcut to open command (Cmd/Ctrl + K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setDropdownOpen(!dropdownOpen);
        setShowCommandDropdown(!showCommandDropdown);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [dropdownOpen, showCommandDropdown]);

  return (
    <div className="fixed top-20 right-15 z-50">
      <div className="relative">
        {/* Search Button */}
        <button
          onMouseEnter={() => setShowCommandDropdown(true)}
          onMouseLeave={() => setShowCommandDropdown(false)}
          onClick={() => {
            setDropdownOpen(!dropdownOpen);
            setShowCommandDropdown(!showCommandDropdown);
          }}
          className="bg-black dark:bg-white text-white dark:text-black border border-border hover:bg-gray-800 dark:hover:bg-gray-100 transition-colors duration-200 rounded-full p-4 shadow-lg group"
          aria-label="Search and navigate sections (Ctrl+K)"
        >
          <svg 
            width="20" 
            height="20" 
            viewBox="0 0 24 24" 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
            className="transition-transform duration-200 group-hover:scale-110"
          >
            <path 
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            />
          </svg>
        </button>
        
        {/* Command Dropdown */}
        <AnimatePresence>
          {showCommandDropdown && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="absolute top-full right-0 mt-2 w-64 bg-background border border-border rounded-lg shadow-lg overflow-hidden backdrop-blur-sm"
              onMouseEnter={() => setShowCommandDropdown(true)}
              onMouseLeave={() => setShowCommandDropdown(false)}
            >
              <Command className="w-full">
                <CommandInput 
                  placeholder="Search sections..." 
                  className="border-0 focus:ring-0" 
                />
                <CommandList className="max-h-[200px]">
                  <CommandEmpty>No results found.</CommandEmpty>
                  <CommandGroup heading="Navigation">
                    <CommandItem 
                      onSelect={() => navigateToSection('hero-intro-section')}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                      <span>Home</span>
                    </CommandItem>
                    
                    <CommandItem 
                      onSelect={() => navigateToSection('info-section')}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>About Us</span>
                    </CommandItem>
                    
                    <CommandItem 
                      onSelect={() => navigateToSection('services-section')}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
                      </svg>
                      <span>Services</span>
                    </CommandItem>
                    
                    <CommandItem 
                      onSelect={() => navigateToSection('faq-section')}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>FAQ</span>
                    </CommandItem>
                    
                    <CommandItem 
                      onSelect={() => navigateToSection('gallery-section')}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span>Gallery</span>
                    </CommandItem>
                    
                    <CommandItem 
                      onSelect={() => navigateToSection('contact-section')}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      <span>Contact</span>
                    </CommandItem>
                  </CommandGroup>

                  <CommandGroup heading="Quick Actions">
                    <CommandItem 
                      onSelect={() => {
                        // Navigate to contact section and switch to form tab
                        const contactSection = document.getElementById('contact-section');
                        if (contactSection) {
                          contactSection.scrollIntoView({ behavior: 'smooth' });
                          setTimeout(() => {
                            const formTab = document.querySelector('[value="form"]') as HTMLElement;
                            if (formTab) {
                              formTab.click();
                            }
                          }, 1000);
                        }
                        setShowCommandDropdown(false);
                      }}
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                      <span>Get Started</span>
                    </CommandItem>
                  </CommandGroup>
                </CommandList>

                {/* Keyboard shortcut hint */}
                <div className="px-3 py-2 border-t border-border bg-muted/30">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Quick access</span>
                    <div className="flex items-center space-x-1">
                      <kbd className="px-1.5 py-0.5 text-xs bg-background border border-border rounded">
                        {navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'}
                      </kbd>
                      <span>+</span>
                      <kbd className="px-1.5 py-0.5 text-xs bg-background border border-border rounded">K</kbd>
                    </div>
                  </div>
                </div>
              </Command>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}