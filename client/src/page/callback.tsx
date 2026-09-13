import {useEffect} from "react";
import {useTranslation} from "react-i18next";
import {useLocation} from "wouter";
import { setAuthToken } from "../utils/auth";

export function CallbackPage() {
    const [, setLocation] = useLocation();
    const { t } = useTranslation();
    useEffect(() => {
        // Try to get token from URL query parameter (for cross-domain OAuth)
        const urlParams = new URLSearchParams(window.location.search);
        const token = urlParams.get('token');
        if (token) {
            setAuthToken(token);
        }
        setLocation("/");
    }, []);
    return (<>
        <div className="w-full h-screen flex justify-center items-center">
            <div className="text-center text-black p-4 text-xl font-bold">
                <p>
                    {t("callback.waiting")}
                </p>
            </div>
        </div>
    </>)
}