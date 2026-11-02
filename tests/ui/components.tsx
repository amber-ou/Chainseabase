// Browser-only test fixture, never included in the Next.js route tree.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/app/globals.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '@/components/ui/select';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';

function Fixture() {
  const [action, setAction] = useState('待操作');
  return <main className="p-6">
    <h1>元件互動測試</h1>
    <Card style={{ maxWidth: 512 }}>
      <CardHeader><CardTitle>產品資料</CardTitle><CardDescription>僅用於元件隔離測試</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldGroup><Field><FieldLabel htmlFor="name">產品名稱</FieldLabel><Input id="name" /></Field></FieldGroup>
        <Badge variant="secondary">{action}</Badge>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline">操作</Button></DropdownMenuTrigger>
          <DropdownMenuContent><DropdownMenuGroup><DropdownMenuItem onSelect={() => setAction('已選取')}>選取產品</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent>
        </DropdownMenu>
        <Tabs defaultValue="list"><TabsList aria-label="檢視"><TabsTrigger value="list">清單</TabsTrigger><TabsTrigger value="detail">詳細</TabsTrigger></TabsList>
          <TabsContent value="list"><Table><TableHeader><TableRow><TableHead>名稱</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>測試產品</TableCell></TableRow></TableBody></Table></TabsContent>
          <TabsContent value="detail">詳細內容</TabsContent>
        </Tabs>
        <Select defaultValue="a"><SelectTrigger aria-label="選擇產品"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="a">產品 A</SelectItem><SelectItem value="b">產品 B</SelectItem></SelectGroup></SelectContent></Select>
        <Dialog><DialogTrigger asChild><Button>編輯</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>編輯產品</DialogTitle><DialogDescription>測試焦點與關閉操作。</DialogDescription></DialogHeader><FieldGroup><Field><FieldLabel htmlFor="edit">新名稱</FieldLabel><Input id="edit" /></Field></FieldGroup></DialogContent></Dialog>
      </CardContent>
      <CardFooter><TooltipProvider><Tooltip><TooltipTrigger asChild><Button variant="ghost">說明</Button></TooltipTrigger><TooltipContent>操作說明</TooltipContent></Tooltip></TooltipProvider></CardFooter>
    </Card>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
