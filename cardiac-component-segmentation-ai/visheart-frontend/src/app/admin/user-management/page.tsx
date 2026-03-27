"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useAuth } from "@/context/auth-context";
import { adminApi } from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  RefreshCw,
  AlertCircle,
  Edit,
  Trash2,
  Search,
  ChevronUp,
  ChevronDown,
  Filter,
  X,
} from "lucide-react";

// Define the user type based on the expected API response
interface AdminUser {
  _id: string;
  username: string;
  email: string;
  phone?: string;
  role: "user" | "admin" | "guest";
}

// Define sort configuration
type SortKey = keyof AdminUser;
type SortDirection = "asc" | "desc";

interface SortConfig {
  key: SortKey;
  direction: SortDirection;
}

// Constants for role styling (performance optimization)
const ROLE_STYLES = {
  admin: "bg-blue-100 text-blue-800",
  guest: "bg-yellow-100 text-yellow-800",
  user: "bg-gray-100 text-gray-800",
} as const;

// Loading skeleton component
const TableSkeleton = React.memo(() => (
  <div className="space-y-3">
    {Array.from({ length: 5 }).map((_, i) => (
      <div key={i} className="flex space-x-4">
        <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-48 animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-16 animate-pulse rounded bg-gray-200" />
        <div className="h-4 w-20 animate-pulse rounded bg-gray-200" />
      </div>
    ))}
  </div>
));

TableSkeleton.displayName = "TableSkeleton";

// Memoized statistics component
const UserStatistics = React.memo(
  ({
    userStats,
  }: {
    userStats: { total: number; admin: number; user: number; guest: number };
  }) => (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>User Statistics</CardTitle>
        <CardDescription>Overview of users in the system</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="rounded-lg border p-4">
            <div className="text-2xl font-bold">{userStats.total}</div>
            <div className="text-muted-foreground text-sm">Total Users</div>
          </div>
          <div className="rounded-lg border p-4">
            <div className="text-2xl font-bold text-blue-600">
              {userStats.admin}
            </div>
            <div className="text-muted-foreground text-sm">Admins</div>
          </div>
          <div className="rounded-lg border p-4">
            <div className="text-2xl font-bold text-green-600">
              {userStats.user}
            </div>
            <div className="text-muted-foreground text-sm">Users</div>
          </div>
          <div className="rounded-lg border p-4">
            <div className="text-2xl font-bold text-yellow-600">
              {userStats.guest}
            </div>
            <div className="text-muted-foreground text-sm">Guests</div>
          </div>
        </div>
      </CardContent>
    </Card>
  ),
);

UserStatistics.displayName = "UserStatistics";

// Memoized table row component for better performance
const UserTableRow = React.memo(
  ({
    user,
    currentUser,
    onEdit,
    onDelete,
  }: {
    user: AdminUser;
    currentUser: any;
    onEdit: (user: AdminUser) => void;
    onDelete: (username: string) => void;
  }) => {
    const handleEdit = useCallback(() => onEdit({ ...user }), [user, onEdit]);
    const handleDelete = useCallback(
      () => onDelete(user.username),
      [user.username, onDelete],
    );
    const isCurrentUser = currentUser?.username === user.username;

    return (
      <TableRow key={user._id}>
        <TableCell className="w-[120px] font-medium">
          <div className="mx-2 truncate" title={user.username}>
            {user.username}
          </div>
        </TableCell>
        <TableCell className="w-[200px]">
          <div className="mx-2 truncate" title={user.email}>
            {user.email}
          </div>
        </TableCell>
        <TableCell className="w-[120px]">
          <div className="mx-2 truncate" title={user.phone || "N/A"}>
            {user.phone || "N/A"}
          </div>
        </TableCell>
        <TableCell className="w-[80px]">
          <div className="mx-2">
            <span
              className={`rounded-full px-2 py-1 text-xs font-medium ${ROLE_STYLES[user.role]}`}
            >
              {user.role}
            </span>
          </div>
        </TableCell>
        <TableCell className="w-[120px]">
          <div className="mx-2 flex justify-end space-x-1">
            <Button
              variant="outline"
              size="sm"
              onClick={handleEdit}
              className="h-8 w-8 p-0"
              title="Edit user"
            >
              <Edit className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isCurrentUser}
                  className="h-8 w-8 p-0"
                  title="Delete user"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Are you sure you want to delete this user?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This action cannot be undone. This will permanently delete
                    the user account <strong>{user.username}</strong> and all
                    associated data.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>
                    Continue
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </TableCell>
      </TableRow>
    );
  },
);

UserTableRow.displayName = "UserTableRow";

export default function AdminPageUserManagement() {
  const { user: currentUser, loading: authLoading } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filtering and sorting states
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<
    "all" | "user" | "admin" | "guest"
  >("all");
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: "username",
    direction: "asc",
  });
  const [showFilters, setShowFilters] = useState(false);

  // Refs for performance optimization
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced search effect
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300); // 300ms debounce

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [searchTerm]);

  // Memoized filter counts for performance
  const filterCounts = useMemo(() => {
    const hasSearch = Boolean(debouncedSearchTerm);
    const hasRoleFilter = roleFilter !== "all";
    const activeCount = (hasSearch ? 1 : 0) + (hasRoleFilter ? 1 : 0);
    return { hasSearch, hasRoleFilter, activeCount };
  }, [debouncedSearchTerm, roleFilter]);

  // Memoized user statistics
  const userStats = useMemo(
    () => ({
      total: users.length,
      admin: users.filter((u) => u.role === "admin").length,
      user: users.filter((u) => u.role === "user").length,
      guest: users.filter((u) => u.role === "guest").length,
    }),
    [users],
  );

  // Filtered and sorted users (optimized search logic)
  const filteredAndSortedUsers = useMemo(() => {
    let filtered = users;

    // Apply filters only if they exist
    if (debouncedSearchTerm || roleFilter !== "all") {
      const searchLower = debouncedSearchTerm.toLowerCase();

      filtered = users.filter((user) => {
        // Text search across username, email, and phone (optimized)
        const searchMatch =
          !debouncedSearchTerm ||
          user.username.toLowerCase().includes(searchLower) ||
          user.email.toLowerCase().includes(searchLower) ||
          user.phone?.toLowerCase().includes(searchLower);

        // Role filter
        const roleMatch = roleFilter === "all" || user.role === roleFilter;

        return searchMatch && roleMatch;
      });
    }

    // Sort the filtered results
    if (filtered.length > 1) {
      filtered.sort((a, b) => {
        const aValue = a[sortConfig.key];
        const bValue = b[sortConfig.key];

        if (aValue === undefined || aValue === null) return 1;
        if (bValue === undefined || bValue === null) return -1;

        const comparison = aValue.toString().localeCompare(bValue.toString());
        return sortConfig.direction === "asc" ? comparison : -comparison;
      });
    }

    return filtered;
  }, [users, debouncedSearchTerm, roleFilter, sortConfig]);

  // Handle sorting (memoized)
  const handleSort = useCallback((key: SortKey) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  }, []);

  // Clear all filters (memoized)
  const clearFilters = useCallback(() => {
    setSearchTerm("");
    setDebouncedSearchTerm("");
    setRoleFilter("all");
    setSortConfig({ key: "username", direction: "asc" });
    // Clear any pending debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
  }, []);

  // Toggle filters (memoized)
  const toggleFilters = useCallback(() => {
    setShowFilters((prev) => !prev);
  }, []);

  // Search handler (memoized with debouncing)
  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
  }, []);

  // Role filter handler (memoized)
  const handleRoleFilterChange = useCallback(
    (value: "all" | "user" | "admin" | "guest") => {
      setRoleFilter(value);
    },
    [],
  );

  const fetchUsers = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await adminApi.getAllUsers();

      if (response.fetch) {
        setUsers(response.users);
      } else {
        const errorMsg = response.message || "Failed to fetch users.";
        setError(errorMsg);
        toast.error(errorMsg);
      }
    } catch (err) {
      const errorMsg = "An error occurred while fetching users.";
      setError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authLoading) {
      fetchUsers();
    }
  }, [currentUser, authLoading]);

  // Keyboard shortcuts (optimized)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === "k") {
        event.preventDefault();
        if (!showFilters) {
          setShowFilters(true);
        }
        // Use requestAnimationFrame for better performance
        requestAnimationFrame(() => {
          const searchInput = document.getElementById("search");
          searchInput?.focus();
        });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showFilters]);

  const handleUpdateUser = useCallback(async () => {
    if (!editingUser) return;

    setIsSubmitting(true);
    try {
      const { username, ...updates } = editingUser;
      const result = await adminApi.adminUpdateUser(username, updates);

      if (result.update) {
        toast.success(`User ${username} updated successfully!`);
        setUsers((prevUsers) =>
          prevUsers.map((u) => (u.username === username ? result.user : u)),
        );
        setEditingUser(null);
      } else {
        toast.error(result.message || "Failed to update user.");
      }
    } catch (err: any) {
      toast.error(
        err.response?.data?.message || err.message || "An error occurred.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [editingUser]);

  const handleDeleteUser = useCallback(async (usernameToDelete: string) => {
    try {
      const result = await adminApi.adminDeleteUser(usernameToDelete);
      if (result.delete) {
        toast.success(result.message);
        setUsers((prevUsers) =>
          prevUsers.filter((u) => u.username !== usernameToDelete),
        );
      } else {
        toast.error(result.message || "Failed to delete user.");
      }
    } catch (err: any) {
      toast.error(
        err.response?.data?.message || err.message || "An error occurred.",
      );
    }
  }, []);

  // Memoized handlers for table row actions
  const handleEditUser = useCallback((user: AdminUser) => {
    setEditingUser(user);
  }, []);

  const handleDeleteUserConfirmed = useCallback(
    (username: string) => {
      handleDeleteUser(username);
    },
    [handleDeleteUser],
  );

  if (authLoading || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <div className="text-red-500">{error}</div>
        <Button onClick={fetchUsers} className="mt-4">
          <RefreshCw className="mr-2 h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* User Statistics */}
      <UserStatistics userStats={userStats} />
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>User Management</CardTitle>
              <CardDescription>
                View, edit, and delete users in the system.{" "}
                {filteredAndSortedUsers.length} of {users.length} users shown.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className={`${
                  debouncedSearchTerm || roleFilter !== "all"
                    ? "border-blue-200 bg-blue-50 text-blue-700"
                    : ""
                }`}
              >
                <Filter className="mr-2 w-4" />
                Filters
                {(debouncedSearchTerm || roleFilter !== "all") && (
                  <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-xs text-white">
                    {(debouncedSearchTerm ? 1 : 0) +
                      (roleFilter !== "all" ? 1 : 0)}
                  </span>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchUsers}
                disabled={isLoading}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filter Controls */}
          <div className="mb-4">
            <div
              className={`overflow-hidden transition-all duration-300 ease-in-out ${
                showFilters ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
              }`}
            >
              <div className="mb-4 space-y-4 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Filters</h3>
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    <X className="mr-1 h-3 w-3" />
                    Clear All
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="flex items-baseline">
                      <Label htmlFor="search" className="text-sm font-medium">
                        Search
                      </Label>
                      <kbd className="bg-muted ml-2 rounded px-1.5 py-0.5 text-xs">
                        Ctrl+K
                      </kbd>
                    </div>
                    <div className="relative">
                      <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                      <Input
                        id="search"
                        placeholder="Search by username, email, or phone..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="h-8 pl-10"
                        disabled={!showFilters}
                      />
                      {searchTerm && searchTerm !== debouncedSearchTerm && (
                        <div className="absolute top-1/2 right-3 -translate-y-1/2">
                          <RefreshCw className="text-muted-foreground h-3 w-3 animate-spin" />
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label
                      htmlFor="role-filter"
                      className="block text-sm font-medium"
                    >
                      Role
                    </Label>
                    <Select
                      value={roleFilter}
                      onValueChange={(value: any) => setRoleFilter(value)}
                      disabled={!showFilters}
                    >
                      <SelectTrigger id="role-filter" className="h-10 w-full">
                        <SelectValue placeholder="Filter by role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Roles</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="guest">Guest</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-md border">
            <div className="overflow-x-auto">
              <Table className="w-full min-w-[640px] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="hover:bg-muted/50 w-[120px] cursor-pointer select-none"
                      onClick={() => handleSort("username")}
                    >
                      <div className="mx-2 flex items-center">
                        Username
                        {sortConfig.key === "username" &&
                          (sortConfig.direction === "asc" ? (
                            <ChevronUp className="ml-1 h-4 w-4" />
                          ) : (
                            <ChevronDown className="ml-1 h-4 w-4" />
                          ))}
                      </div>
                    </TableHead>
                    <TableHead
                      className="hover:bg-muted/50 w-[200px] cursor-pointer select-none"
                      onClick={() => handleSort("email")}
                    >
                      <div className="mx-2 flex items-center">
                        Email
                        {sortConfig.key === "email" &&
                          (sortConfig.direction === "asc" ? (
                            <ChevronUp className="ml-1 h-4 w-4" />
                          ) : (
                            <ChevronDown className="ml-1 h-4 w-4" />
                          ))}
                      </div>
                    </TableHead>
                    <TableHead
                      className="hover:bg-muted/50 w-[120px] cursor-pointer select-none"
                      onClick={() => handleSort("phone")}
                    >
                      <div className="mx-2 flex items-center">
                        Phone
                        {sortConfig.key === "phone" &&
                          (sortConfig.direction === "asc" ? (
                            <ChevronUp className="ml-1 h-4 w-4" />
                          ) : (
                            <ChevronDown className="ml-1 h-4 w-4" />
                          ))}
                      </div>
                    </TableHead>
                    <TableHead
                      className="hover:bg-muted/50 w-[80px] cursor-pointer select-none"
                      onClick={() => handleSort("role")}
                    >
                      <div className="mx-2 flex items-center">
                        Role
                        {sortConfig.key === "role" &&
                          (sortConfig.direction === "asc" ? (
                            <ChevronUp className="ml-1 h-4 w-4" />
                          ) : (
                            <ChevronDown className="ml-1 h-4 w-4" />
                          ))}
                      </div>
                    </TableHead>
                    <TableHead className="w-[120px] text-right">
                      <div className="mx-2">Actions</div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-6">
                        <TableSkeleton />
                      </TableCell>
                    </TableRow>
                  ) : filteredAndSortedUsers.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-muted-foreground py-6 text-center"
                      >
                        <div className="mx-2">
                          {users.length === 0
                            ? "No users found."
                            : "No users match the current filters."}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAndSortedUsers.map((user) => (
                      <UserTableRow
                        key={user._id}
                        user={user}
                        currentUser={currentUser}
                        onEdit={handleEditUser}
                        onDelete={handleDeleteUserConfirmed}
                      />
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit User Dialog */}
      {editingUser && (
        <Dialog
          open={Boolean(editingUser)}
          onOpenChange={(open) => {
            if (!open) setEditingUser(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit User: {editingUser.username}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input id="username" value={editingUser.username} disabled />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  value={editingUser.email}
                  onChange={(e) =>
                    setEditingUser({ ...editingUser, email: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={editingUser.phone || ""}
                  onChange={(e) =>
                    setEditingUser({ ...editingUser, phone: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select
                  value={editingUser.role}
                  onValueChange={(value: "user" | "admin") =>
                    setEditingUser({ ...editingUser, role: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleUpdateUser}
                disabled={isSubmitting}
                className="w-full"
              >
                {isSubmitting ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
