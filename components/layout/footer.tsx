export function Footer() {
    return (
        <footer className="border-t border-border bg-background py-8">
            <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
                &copy; {new Date().getFullYear()} Academia del Código
            </div>
        </footer>
    );
}
