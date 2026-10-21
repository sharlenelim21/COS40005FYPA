"use client";

import React, { useState, useCallback } from "react";
import { useAuth } from "@/context/auth-context";
import { authApi } from "@/lib/api";

// --- UI Component Imports ---
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// --- Icon Imports ---
import {
  User,
  Mail,
  Phone,
  Lock,
  Eye,
  EyeOff,
  UserPlus,
  Loader2,
  AlertCircle,
  CheckCircle,
  ArrowUp,
  Stethoscope,
  Upload,
} from "lucide-react";

/** Must match ALLOWED_PROFESSIONS in Cardiac_Segmentation_FYP_Server/src/routes/authentication.ts */
const PROFESSIONS = [
  "MRI Radiographer / Cardiac Imaging Technologist",
  "Cardiac Physiologist / Cardiovascular Technologist",
  "Nurse / Medical Assistant",
  "Doctor (Cardiologist)",
] as const;

/**
 * Form data interface for user registration
 * Matches the backend API requirements for /auth/register and /auth/register-from-guest
 */
interface RegistrationFormData {
  username: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  // Medical staff elevation request fields — only used/validated when isMedicalStaff is checked.
  // The role itself is never granted here; this only flags the account for Admin review.
  isMedicalStaff: boolean;
  profession: string;
  medicalId: string;
  requestedRole: "doctor" | "clinical_assistant" | "";
  reason: string;
}

/**
 * Form validation errors interface
 * Provides type-safe error handling for each form field
 */
interface FormErrors {
  username?: string;
  email?: string;
  phone?: string;
  password?: string;
  confirmPassword?: string;
  profession?: string;
  medicalId?: string;
  requestedRole?: string;
  staffIdCard?: string;
  general?: string;
}

/**
 * Props interface for the RegistrationForm component
 */
interface RegistrationFormProps {
  /**
   * Whether this registration is upgrading from a guest account
   * When true, uses the register-from-guest API endpoint
   * NOTE: This is automatically detected based on user.role === "guest",
   * but can be manually overridden if needed
   */
  isGuestUpgrade?: boolean;
  /**
   * Optional callback function called when registration is successful
   * @param userData - The registered user data returned from the API
   */
  onSuccess?: (userData: unknown) => void;
  /**
   * Optional CSS class name for custom styling
   */
  className?: string;
}

/**
 * Validates email format using a comprehensive regex pattern
 */
const validateEmail = (email: string): boolean => {
  if (!email || email.trim() === "") return false;

  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  const trimmedEmail = email.trim().toLowerCase();

  return (
    trimmedEmail.length <= 254 &&
    !trimmedEmail.includes("..") &&
    !trimmedEmail.startsWith(".") &&
    !trimmedEmail.endsWith(".") &&
    emailRegex.test(trimmedEmail)
  );
};

/**
 * Validates phone number format (international and local formats)
 */
const validatePhone = (phone: string): boolean => {
  if (!phone || phone.trim() === "") return false;

  const cleanPhone = phone.replace(/[^\d+]/g, "");
  const digitCount = cleanPhone.replace(/^\+/, "").length;

  return (
    digitCount >= 7 &&
    digitCount <= 15 &&
    (/^\+[1-9]\d{6,14}$/.test(cleanPhone) ||
      /^[0-9]\d{6,14}$/.test(cleanPhone) ||
      (cleanPhone.length === 10 &&
        /^[2-9]\d{2}[2-9]\d{2}\d{4}$/.test(cleanPhone)))
  );
};

/**
 * Validates password strength based on security requirements
 */
const validatePassword = (password: string) => {
  if (!password) {
    return { isValid: false, error: "Password is required" };
  }

  if (password.length < 8) {
    return {
      isValid: false,
      error: "Password must be at least 8 characters long",
    };
  }

  if (password.length > 128) {
    return {
      isValid: false,
      error: "Password must be no more than 128 characters long",
    };
  }

  if (!/(?=.*[a-z])/.test(password)) {
    return {
      isValid: false,
      error: "Password must contain at least one lowercase letter",
    };
  }

  if (!/(?=.*[A-Z])/.test(password)) {
    return {
      isValid: false,
      error: "Password must contain at least one uppercase letter",
    };
  }

  if (!/(?=.*\d)/.test(password)) {
    return {
      isValid: false,
      error: "Password must contain at least one number",
    };
  }

  if (!/(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/.test(password)) {
    return {
      isValid: false,
      error:
        "Password must contain at least one special character (!@#$%^&*()_+-=[]{}|;':\",./<>?)",
    };
  }

  const commonPasswords = [
    "password",
    "password123",
    "123456789",
    "qwerty123",
    "abc123456",
    "password1",
    "admin123",
    "welcome123",
    "letmein123",
  ];

  if (commonPasswords.includes(password.toLowerCase())) {
    return {
      isValid: false,
      error:
        "This password is too common. Please choose a more secure password",
    };
  }

  if (/(.)\1{3,}/.test(password)) {
    return {
      isValid: false,
      error:
        "Password cannot contain more than 3 consecutive identical characters",
    };
  }

  return { isValid: true, error: "" };
};

/**
 * Validates username format and length requirements
 */
const validateUsername = (username: string) => {
  if (!username || username.trim() === "") {
    return { isValid: false, error: "Username is required" };
  }

  const trimmedUsername = username.trim();

  if (trimmedUsername.length < 3) {
    return {
      isValid: false,
      error: "Username must be at least 3 characters long",
    };
  }

  if (trimmedUsername.length > 20) {
    return {
      isValid: false,
      error: "Username must be no more than 20 characters long",
    };
  }

  if (!/^[a-zA-Z0-9]/.test(trimmedUsername)) {
    return {
      isValid: false,
      error: "Username must start with a letter or number",
    };
  }

  if (!/[a-zA-Z0-9]$/.test(trimmedUsername)) {
    return {
      isValid: false,
      error: "Username must end with a letter or number",
    };
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(trimmedUsername)) {
    return {
      isValid: false,
      error:
        "Username can only contain letters, numbers, underscores, and hyphens",
    };
  }

  if (/[_-]{2,}/.test(trimmedUsername)) {
    return {
      isValid: false,
      error: "Username cannot have consecutive underscores or hyphens",
    };
  }

  const reservedUsernames = [
    "admin",
    "root",
    "system",
    "api",
    "www",
    "mail",
    "test",
    "guest",
    "user",
  ];

  if (reservedUsernames.includes(trimmedUsername.toLowerCase())) {
    return {
      isValid: false,
      error: "This username is reserved and cannot be used",
    };
  }

  return { isValid: true, error: "" };
};

/**
 * Reusable password input component
 */
const PasswordInput: React.FC<{
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  showPassword: boolean;
  onToggleVisibility: () => void;
}> = ({
  id,
  label,
  placeholder,
  value,
  onChange,
  error,
  disabled,
  showPassword,
  onToggleVisibility,
}) => (
  <div className="space-y-2">
    <Label htmlFor={id} className="text-sm font-medium">
      {label} *
    </Label>
    <div className="relative">
      <Lock className="text-muted-foreground absolute top-3 left-3 h-4 w-4" />
      <Input
        id={id}
        type={showPassword ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`pr-10 pl-10 ${error ? "border-destructive" : ""}`}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        disabled={disabled}
        required
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute top-1 right-1 h-8 w-8 p-0"
        onClick={onToggleVisibility}
        aria-label={showPassword ? "Hide password" : "Show password"}
        tabIndex={-1}
      >
        {showPassword ? (
          <EyeOff className="h-4 w-4" />
        ) : (
          <Eye className="h-4 w-4" />
        )}
      </Button>
    </div>
    {error && (
      <p
        id={`${id}-error`}
        className="text-destructive flex items-center gap-1 text-sm"
      >
        <AlertCircle className="h-3 w-3" />
        {error}
      </p>
    )}
  </div>
);

/**
 * RegistrationForm Component
 *
 * A comprehensive user registration form built with shadcn/ui components.
 * Supports both new user registration and guest account upgrades.
 * Includes robust validation, error handling, and accessibility features.
 *
 * Features:
 * - Real-time form validation with user-friendly error messages
 * - Password strength validation and confirmation matching
 * - Responsive design with proper mobile support
 * - Loading states and error handling
 * - Guest account upgrade support
 * - Accessibility compliant (ARIA labels, keyboard navigation)
 * - TypeScript strict mode compliance
 *
 * @param props - Component properties
 * @returns JSX.Element - Rendered registration form
 */
export const RegistrationForm: React.FC<RegistrationFormProps> = ({
  isGuestUpgrade = false,
  onSuccess,
  className = "",
}) => {
  // --- Hooks ---
  const { user, loading: authLoading } = useAuth();

  // --- Auto-detect guest upgrade mode ---
  const isActuallyGuestUpgrade =
    Boolean(user?.role === "guest") || isGuestUpgrade;

  // --- Form State ---
  const [formData, setFormData] = useState<RegistrationFormData>({
    username: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
    isMedicalStaff: false,
    profession: "",
    medicalId: "",
    requestedRole: "",
    reason: "",
  });
  const [staffIdCardFile, setStaffIdCardFile] = useState<File | null>(null);

  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // --- Validation Functions ---

  /**
   * Comprehensive form validation function
   * Validates all form fields and returns error object
   */
  const validateForm = useCallback((data: RegistrationFormData): FormErrors => {
    const newErrors: FormErrors = {};

    // Username validation
    const usernameValidation = validateUsername(data.username);
    if (!usernameValidation.isValid) {
      newErrors.username = usernameValidation.error;
    }

    // Email validation
    if (!data.email) {
      newErrors.email = "Email is required";
    } else if (!validateEmail(data.email)) {
      newErrors.email = "Please enter a valid email address";
    }

    // Phone validation
    if (!data.phone) {
      newErrors.phone = "Phone number is required";
    } else if (!validatePhone(data.phone)) {
      newErrors.phone = "Please enter a valid phone number";
    }

    // Password validation
    const passwordValidation = validatePassword(data.password);
    if (!passwordValidation.isValid) {
      newErrors.password = passwordValidation.error;
    }

    // Confirm password validation
    if (!data.confirmPassword) {
      newErrors.confirmPassword = "Please confirm your password";
    } else if (data.password !== data.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match";
    }

    // Medical staff elevation request fields — only required when the checkbox is ticked.
    if (data.isMedicalStaff) {
      if (!data.profession) {
        newErrors.profession = "Select your profession";
      }
      if (!data.medicalId.trim()) {
        newErrors.medicalId = "Your medical/registration ID is required";
      }
      if (!data.requestedRole) {
        newErrors.requestedRole = "Select the access you're requesting";
      }
      if (!staffIdCardFile) {
        newErrors.staffIdCard = "Upload a photo or PDF of your staff ID card";
      } else if (staffIdCardFile.size > 5 * 1024 * 1024) {
        newErrors.staffIdCard = "File must be 5MB or smaller";
      } else if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(staffIdCardFile.type)) {
        newErrors.staffIdCard = "Only JPEG, PNG, WebP, or PDF files are accepted";
      }
    }

    return newErrors;
  }, [staffIdCardFile]);

  // --- Event Handlers ---

  /**
   * Handles input field changes with real-time validation
   */
  const handleInputChange = useCallback(
    (field: keyof RegistrationFormData, value: string | boolean) => {
      setFormData((prev) => ({ ...prev, [field]: value }));

      // Clear field-specific error when user starts typing
      if (errors[field as keyof FormErrors]) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
      }
    },
    [errors],
  );

  /**
   * Handles form submission with comprehensive error handling
   */
  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      // Validate form before submission
      const validationErrors = validateForm(formData);
      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors);
        return;
      }

      setIsLoading(true);
      setErrors({});

      try {
        let response;
        if (isActuallyGuestUpgrade) {
          // Guest upgrade stays a plain JSON call — always lands as EducationalUser too; a
          // newly-upgraded account can request elevation afterward from their dashboard.
          const { username, email, phone, password } = formData;
          response = await authApi.registerFromGuest({ username, email, phone, password });
        } else {
          const apiForm = new FormData();
          apiForm.set("username", formData.username);
          apiForm.set("email", formData.email);
          apiForm.set("phone", formData.phone);
          apiForm.set("password", formData.password);
          if (formData.isMedicalStaff) {
            apiForm.set("isMedicalStaff", "true");
            apiForm.set("profession", formData.profession);
            apiForm.set("medicalId", formData.medicalId.trim());
            apiForm.set("requestedRole", formData.requestedRole);
            if (formData.reason.trim()) apiForm.set("reason", formData.reason.trim());
            if (staffIdCardFile) apiForm.set("staffIdCard", staffIdCardFile);
          }
          response = await authApi.register(apiForm);
        }

        if (response.register) {
          console.log(
            isActuallyGuestUpgrade
              ? "Account upgraded successfully! Welcome to VisHeart!"
              : "Registration successful! Welcome to VisHeart!",
          );

          // Set success state to show success message
          setIsSuccess(true);

          // Call success callback if provided
          if (onSuccess) {
            onSuccess(response.user);
          }
        } else {
          // Handle API-level errors
          setErrors({ general: response.message || "Registration failed" });
        }
      } catch (error: any) {
        console.error("Registration error:", error);

        // Handle different types of errors
        if (error.response?.data?.errors) {
          // Handle validation errors from backend
          const backendErrors: FormErrors = {};
          error.response.data.errors.forEach((err: any) => {
            if (err.path) {
              backendErrors[err.path as keyof FormErrors] = err.msg;
            }
          });
          setErrors(backendErrors);
        } else if (error.response?.data?.message) {
          setErrors({ general: error.response.data.message });
        } else {
          setErrors({
            general: "An unexpected error occurred. Please try again.",
          });
        }
      } finally {
        setIsLoading(false);
      }
    },
    [formData, validateForm, isActuallyGuestUpgrade, onSuccess, staffIdCardFile],
  );

  // Show loading state while auth is being determined
  if (authLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // --- Render ---
  return (
    <Card className={`mx-auto w-full max-w-md shadow-lg ${className}`}>
      <CardHeader className="space-y-1 text-center">
        <div className="mb-4 flex items-center justify-center">
          <div className="bg-primary/10 rounded-full p-3">
            {isActuallyGuestUpgrade ? (
              <ArrowUp className="text-primary h-6 w-6" />
            ) : (
              <UserPlus className="text-primary h-6 w-6" />
            )}
          </div>
        </div>
        <CardTitle className="text-2xl font-bold">
          {isActuallyGuestUpgrade
            ? "Complete Your Registration"
            : "Create Your Account"}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {isActuallyGuestUpgrade
            ? "Upgrade your guest account to save your work and access all features"
            : "Join VisHeart to start your cardiac segmentation journey"}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/* Success Message */}
        {isSuccess && (
          <div className="space-y-4 text-center">
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                <strong>
                  {isActuallyGuestUpgrade
                    ? "Account upgraded successfully!"
                    : "Account created successfully!"}
                </strong>
                <br />
                Please sign in using the Sign In button in the header to access
                your account.
              </AlertDescription>
            </Alert>
          </div>
        )}

        {/* Registration Form - Hide when successful */}
        {!isSuccess && (
          <>
            {/* Guest Upgrade Info Banner */}
            {isActuallyGuestUpgrade && user?.role === "guest" && (
              <Alert className="mb-4 border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30">
                <AlertCircle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <AlertDescription className="text-blue-800 dark:text-blue-200">
                  <strong>Welcome back, {user.username}!</strong>
                  <br />
                  Complete your registration to save your projects and access
                  all features.
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {/* General Error Alert */}
              {errors.general && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{errors.general}</AlertDescription>
                </Alert>
              )}

              {/* Username Field */}
              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm font-medium">
                  Username *
                </Label>
                <div className="relative">
                  <User className="text-muted-foreground absolute top-3 left-3 h-4 w-4" />
                  <Input
                    id="username"
                    type="text"
                    placeholder="Enter your username"
                    value={formData.username}
                    onChange={(e) =>
                      handleInputChange("username", e.target.value)
                    }
                    className={`pl-10 ${errors.username ? "border-destructive" : ""}`}
                    aria-invalid={!!errors.username}
                    aria-describedby={
                      errors.username ? "username-error" : undefined
                    }
                    disabled={isLoading}
                    required
                  />
                </div>
                {errors.username && (
                  <p
                    id="username-error"
                    className="text-destructive flex items-center gap-1 text-sm"
                  >
                    <AlertCircle className="h-3 w-3" />
                    {errors.username}
                  </p>
                )}
              </div>

              {/* Email Field */}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  Email Address *
                </Label>
                <div className="relative">
                  <Mail className="text-muted-foreground absolute top-3 left-3 h-4 w-4" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="Enter your email address"
                    value={formData.email}
                    onChange={(e) => handleInputChange("email", e.target.value)}
                    className={`pl-10 ${errors.email ? "border-destructive" : ""}`}
                    aria-invalid={!!errors.email}
                    aria-describedby={errors.email ? "email-error" : undefined}
                    disabled={isLoading}
                    required
                  />
                </div>
                {errors.email && (
                  <p
                    id="email-error"
                    className="text-destructive flex items-center gap-1 text-sm"
                  >
                    <AlertCircle className="h-3 w-3" />
                    {errors.email}
                  </p>
                )}
              </div>

              {/* Phone Field */}
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-sm font-medium">
                  Phone Number *
                </Label>
                <div className="relative">
                  <Phone className="text-muted-foreground absolute top-3 left-3 h-4 w-4" />
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="e.g., +1234567890 or (555) 123-4567"
                    value={formData.phone}
                    onChange={(e) => handleInputChange("phone", e.target.value)}
                    className={`pl-10 ${errors.phone ? "border-destructive" : ""}`}
                    aria-invalid={!!errors.phone}
                    aria-describedby={errors.phone ? "phone-error" : undefined}
                    disabled={isLoading}
                    required
                  />
                </div>
                {errors.phone && (
                  <p
                    id="phone-error"
                    className="text-destructive flex items-center gap-1 text-sm"
                  >
                    <AlertCircle className="h-3 w-3" />
                    {errors.phone}
                  </p>
                )}
              </div>

              {/* Medical Staff Elevation Request */}
              {!isActuallyGuestUpgrade && (
                <div className="space-y-4 rounded-lg border p-4">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="isMedicalStaff"
                      checked={formData.isMedicalStaff}
                      onCheckedChange={(checked) => handleInputChange("isMedicalStaff", checked === true)}
                      disabled={isLoading}
                    />
                    <Label htmlFor="isMedicalStaff" className="text-sm leading-tight font-normal">
                      I am a medical staff member and would like to request Doctor or Clinical
                      Assistant access (reviewed by an Admin — you'll start with Educational
                      access in the meantime).
                    </Label>
                  </div>

                  {formData.isMedicalStaff && (
                    <div className="space-y-4 border-t pt-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Stethoscope className="h-4 w-4" />
                        Staff verification details
                      </div>

                      {/* Profession */}
                      <div className="space-y-2">
                        <Label htmlFor="profession" className="text-sm font-medium">
                          Profession *
                        </Label>
                        <Select
                          value={formData.profession}
                          onValueChange={(value: string) => handleInputChange("profession", value)}
                          disabled={isLoading}
                        >
                          <SelectTrigger id="profession" className={errors.profession ? "border-destructive" : ""}>
                            <SelectValue placeholder="Select your profession" />
                          </SelectTrigger>
                          <SelectContent>
                            {PROFESSIONS.map((p) => (
                              <SelectItem key={p} value={p}>{p}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {errors.profession && (
                          <p className="text-destructive flex items-center gap-1 text-sm">
                            <AlertCircle className="h-3 w-3" />
                            {errors.profession}
                          </p>
                        )}
                      </div>

                      {/* Medical ID */}
                      <div className="space-y-2">
                        <Label htmlFor="medicalId" className="text-sm font-medium">
                          Medical / Registration ID *
                        </Label>
                        <Input
                          id="medicalId"
                          type="text"
                          placeholder="e.g. MMC number, Nursing Board number, MAHPC number"
                          value={formData.medicalId}
                          onChange={(e) => handleInputChange("medicalId", e.target.value)}
                          className={errors.medicalId ? "border-destructive" : ""}
                          disabled={isLoading}
                        />
                        {errors.medicalId && (
                          <p className="text-destructive flex items-center gap-1 text-sm">
                            <AlertCircle className="h-3 w-3" />
                            {errors.medicalId}
                          </p>
                        )}
                      </div>

                      {/* Requested role */}
                      <div className="space-y-2">
                        <Label htmlFor="requestedRole" className="text-sm font-medium">
                          Requested Access *
                        </Label>
                        <Select
                          value={formData.requestedRole}
                          onValueChange={(value: string) => handleInputChange("requestedRole", value as "doctor" | "clinical_assistant")}
                          disabled={isLoading}
                        >
                          <SelectTrigger id="requestedRole" className={errors.requestedRole ? "border-destructive" : ""}>
                            <SelectValue placeholder="Select the access you need" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="doctor">Doctor</SelectItem>
                            <SelectItem value="clinical_assistant">Clinical Assistant</SelectItem>
                          </SelectContent>
                        </Select>
                        {errors.requestedRole && (
                          <p className="text-destructive flex items-center gap-1 text-sm">
                            <AlertCircle className="h-3 w-3" />
                            {errors.requestedRole}
                          </p>
                        )}
                      </div>

                      {/* Staff ID card upload */}
                      <div className="space-y-2">
                        <Label htmlFor="staffIdCard" className="text-sm font-medium">
                          Staff ID Card *
                        </Label>
                        <div className="relative">
                          <Upload className="text-muted-foreground absolute top-3 left-3 h-4 w-4" />
                          <Input
                            id="staffIdCard"
                            type="file"
                            accept="image/jpeg,image/png,image/webp,application/pdf"
                            onChange={(e) => {
                              setStaffIdCardFile(e.target.files?.[0] ?? null);
                              if (errors.staffIdCard) setErrors((prev) => ({ ...prev, staffIdCard: undefined }));
                            }}
                            className={`pl-10 ${errors.staffIdCard ? "border-destructive" : ""}`}
                            disabled={isLoading}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">JPEG, PNG, WebP, or PDF — max 5MB. Kept private, visible only to an Admin reviewing your request.</p>
                        {errors.staffIdCard && (
                          <p className="text-destructive flex items-center gap-1 text-sm">
                            <AlertCircle className="h-3 w-3" />
                            {errors.staffIdCard}
                          </p>
                        )}
                      </div>

                      {/* Reason (optional) */}
                      <div className="space-y-2">
                        <Label htmlFor="reason" className="text-sm font-medium">
                          Reason for access (optional)
                        </Label>
                        <Textarea
                          id="reason"
                          placeholder="Briefly explain why you need Doctor/Clinical Assistant access"
                          value={formData.reason}
                          onChange={(e) => handleInputChange("reason", e.target.value)}
                          disabled={isLoading}
                          rows={2}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Password Field */}
              <PasswordInput
                id="password"
                label="Password"
                placeholder="8+ chars with uppercase, lowercase, number & symbol"
                value={formData.password}
                onChange={(value) => handleInputChange("password", value)}
                error={errors.password}
                disabled={isLoading}
                showPassword={showPassword}
                onToggleVisibility={() => setShowPassword(!showPassword)}
              />

              {/* Confirm Password Field */}
              <PasswordInput
                id="confirmPassword"
                label="Confirm Password"
                placeholder="Confirm your password"
                value={formData.confirmPassword}
                onChange={(value) =>
                  handleInputChange("confirmPassword", value)
                }
                error={errors.confirmPassword}
                disabled={isLoading}
                showPassword={showConfirmPassword}
                onToggleVisibility={() =>
                  setShowConfirmPassword(!showConfirmPassword)
                }
              />

              {/* Submit Button */}
              <Button
                type="submit"
                className="w-full"
                disabled={isLoading}
                size="lg"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {isActuallyGuestUpgrade
                      ? "Upgrading Account..."
                      : "Creating Account..."}
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    {isActuallyGuestUpgrade
                      ? "Complete Registration"
                      : "Create Account"}
                  </>
                )}
              </Button>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default RegistrationForm;
