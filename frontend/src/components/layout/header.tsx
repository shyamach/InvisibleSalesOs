"use client";

import { Bell, ChevronDown, LogOut, Settings, User } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface HeaderProps {
  title: string;
  description?: string;
}

export function Header({ title, description }: HeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border/60 bg-background/80 px-8 backdrop-blur-sm">
      <div>
        <h1 className="text-base font-medium tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="text-muted-foreground">
          <Bell className="size-4" strokeWidth={1.5} />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-foreground outline-none transition-colors hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring/50">
            <Avatar className="size-7">
              <AvatarFallback className="bg-foreground/10 text-[10px] font-medium text-foreground">
                SC
              </AvatarFallback>
            </Avatar>
            <div className="hidden text-left sm:block">
              <p className="text-xs font-medium leading-none">Shyam Achand</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Admin
              </p>
            </div>
            <ChevronDown className="size-3.5 text-muted-foreground" strokeWidth={1.5} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium">Shyam Achand</p>
              <p className="text-xs text-muted-foreground">
                shyam@invisiblesales.io
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <User className="size-4" strokeWidth={1.5} />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Settings className="size-4" strokeWidth={1.5} />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive">
              <LogOut className="size-4" strokeWidth={1.5} />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
