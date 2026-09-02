import { useState, useRef } from "react";
import { Button } from "./ui/button";
import { X, Upload, Loader2, Image as ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function MediaUpload({
  value,
  onChange,
  maxFiles = 6,
  context,
}: {
  value: string[];
  onChange: (val: string[]) => void;
  maxFiles?: number;
  context: "review" | "rma";
}) {
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    if (value.length + files.length > maxFiles) {
      toast.error(`Možete dodati najviše ${maxFiles} slika.`);
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("files", files[i]);
      }
      formData.append("context", context);
      
      const urls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let contentType = file.type;
        if (contentType !== 'image/jpeg' && contentType !== 'image/png' && contentType !== 'image/webp') contentType = 'image/jpeg';
        
        // 1. Request ticket
        const ticketRes = await fetch("/api/media/uploads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: context === "review" ? "retail-review-photo" : "rma-photo",
            name: file.name,
            size: file.size,
            contentType: contentType
          })
        });
        if (!ticketRes.ok) throw new Error("Upload request failed");
        const ticket = await ticketRes.json();

        // 2. Upload to storage
        const putRes = await fetch(ticket.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: file
        });
        if (!putRes.ok) throw new Error("Storage upload failed");

        // 3. Finalize
        const finRes = await fetch(`/api/media/uploads/${ticket.id}/finalize`, {
          method: "POST"
        });
        if (!finRes.ok) throw new Error("Finalize failed");
        const asset = await finRes.json();
        urls.push(asset.url);
      }
      
      onChange([...value, ...urls]);
    } catch (err) {
      toast.error("Greška pri otpremanju slika.");
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeFile = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((url, i) => (
            <div key={i} className="relative w-16 h-16 rounded-md overflow-hidden border bg-muted group">
              <img src={url} className="w-full h-full object-cover" alt="Uploaded" />
              <button 
                type="button" 
                onClick={() => removeFile(i)}
                className="absolute inset-0 bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          {value.length < maxFiles && (
            <button 
              type="button" 
              onClick={() => inputRef.current?.click()}
              className="w-16 h-16 rounded-md border border-dashed flex items-center justify-center bg-muted/30 hover:bg-muted/50 text-muted-foreground transition-colors"
            >
              <Upload className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {value.length === 0 && (
        <Button 
          type="button" 
          variant="outline" 
          className="w-full h-20 border-dashed"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
        >
          {isUploading ? (
            <Loader2 className="w-5 h-5 mr-2 animate-spin text-muted-foreground" />
          ) : (
            <ImageIcon className="w-5 h-5 mr-2 text-muted-foreground" />
          )}
          <span className="text-muted-foreground font-normal">Dodaj fotografije (do {maxFiles})</span>
        </Button>
      )}
      
      <input 
        ref={inputRef} 
        type="file" 
        multiple 
        accept="image/jpeg, image/png, image/webp" 
        className="hidden" 
        onChange={handleFileChange} 
      />
    </div>
  );
}